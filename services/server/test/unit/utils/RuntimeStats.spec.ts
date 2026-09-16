import { expect } from "chai";
import sinon from "sinon";
import { Worker } from "node:worker_threads";
import logger from "../../../src/common/logger";
import { HotWorkerProfiler } from "../../../src/server/services/utils/HotWorkerProfiler";
import type { RuntimeStatsSource } from "../../../src/server/services/utils/RuntimeStats";
import { RuntimeStats } from "../../../src/server/services/utils/RuntimeStats";
import type { RunningTaskInfo } from "../../../src/server/services/VerificationService";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Announces a task like verificationWorker.ts and then blocks its thread
const SPINNING_WORKER_SCRIPT = `
  const { parentPort, threadId } = require("node:worker_threads");
  parentPort.postMessage({ type: "task-start", threadId, verificationId: "job-1" });
  let counter = 0;
  while (true) { counter = (counter + 1) % 1000; }
`;

describe("RuntimeStats", function () {
  const sandbox = sinon.createSandbox();
  let worker: Worker | undefined;

  afterEach(async function () {
    sandbox.restore();
    if (worker) {
      await worker.terminate();
      worker = undefined;
    }
  });

  function createSource(
    threads: Worker[],
    tasksByThread: Map<number, RunningTaskInfo[]>,
  ): RuntimeStatsSource {
    return {
      getWorkerThreads: () => threads,
      getWorkerPoolStats: () => ({
        utilization: 0.5,
        queueSize: 0,
        completed: 3,
        threads: threads.length,
        runTime: { p50: 12.5, p99: 40 },
        waitTime: { p50: 0.1, p99: 1 },
      }),
      getRunningTasksByThread: (threadId) => tasksByThread.get(threadId) ?? [],
    };
  }

  it("logs a stats line with main, worker, pool, cpu and memory fields", async function () {
    const infoStub: sinon.SinonStub = sandbox.stub(logger, "info");
    worker = new Worker("setInterval(() => {}, 1000)", { eval: true });
    const runtimeStats = new RuntimeStats(createSource([worker], new Map()), {
      intervalMs: 60_000,
    });

    await wait(50);
    runtimeStats.tick();
    await wait(50);
    runtimeStats.tick();

    const statsCalls = infoStub
      .getCalls()
      .filter((call) => call.args[0] === "Runtime stats");
    expect(statsCalls).to.have.length(2);
    // The first tick of a thread only takes the baseline
    expect(statsCalls[0].args[1].workers[0].elu).to.be.null;

    const stats = statsCalls[1].args[1];
    expect(stats.uptimeSec).to.be.a("number");
    expect(stats.mainElu).to.be.within(0, 1);
    expect(stats.workers).to.have.length(1);
    expect(stats.workers[0].threadId).to.equal(worker.threadId);
    expect(stats.workers[0].elu).to.be.within(0, 1);
    expect(stats.workers[0].tasks).to.deep.equal([]);
    expect(stats.pool).to.deep.equal({
      utilization: 0.5,
      queueSize: 0,
      completed: 3,
      threads: 1,
      runTime: { p50: 12.5, p99: 40 },
      waitTime: { p50: 0.1, p99: 1 },
    });
    expect(stats.cpu.userMs).to.be.at.least(0);
    expect(stats.cpu.systemMs).to.be.at.least(0);
    expect(stats.cpu.cores).to.be.at.least(0);
    expect(stats.mem.rss).to.be.above(0);
    expect(stats.mem.maxRSS).to.be.above(0);
  });

  it("logs a warning instead of throwing when a tick fails", function () {
    const warnStub: sinon.SinonStub = sandbox.stub(logger, "warn");
    const runtimeStats = new RuntimeStats(
      {
        getWorkerThreads: () => {
          throw new Error("boom");
        },
        getWorkerPoolStats: () => {
          throw new Error("boom");
        },
        getRunningTasksByThread: () => [],
      },
      { intervalMs: 60_000 },
    );

    expect(() => runtimeStats.tick()).to.not.throw();
    expect(warnStub.calledOnceWith("Failed to collect runtime stats")).to.be
      .true;
  });

  it("warns once at startup when CPU profiling is not supported", function () {
    const warnStub: sinon.SinonStub = sandbox.stub(logger, "warn");
    sandbox.stub(HotWorkerProfiler, "isSupported").returns(false);

    new RuntimeStats(createSource([], new Map()), {
      intervalMs: 60_000,
      cpuProfile: {
        eluThreshold: 0.9,
        sustainTicks: 3,
        durationMs: 1000,
        cooldownMs: 1000,
        topN: 5,
      },
    });

    expect(warnStub.calledOnce).to.be.true;
    expect(warnStub.firstCall.args[0]).to.include("needs Node >= 22.20");
  });

  // Slow: spins a real worker thread and captures a CPU profile of it.
  it("profiles a spinning worker thread and attributes it to its task", async function () {
    if (!HotWorkerProfiler.isSupported()) {
      this.skip();
    }
    this.timeout(20_000);
    const warnStub: sinon.SinonStub = sandbox.stub(logger, "warn");
    sandbox.stub(logger, "info");

    worker = new Worker(SPINNING_WORKER_SCRIPT, { eval: true });
    const tasksByThread = new Map<number, RunningTaskInfo[]>();
    const announced = new Promise<void>((resolve) => {
      worker!.once("message", (message) => {
        tasksByThread.set(message.threadId, [
          {
            verificationId: message.verificationId,
            functionName: "verifyFromJsonInput",
            chainId: "1",
            address: "0x1234567890123456789012345678901234567890",
            startedAt: new Date(),
            threadId: message.threadId,
          },
        ]);
        resolve();
      });
    });
    const runtimeStats = new RuntimeStats(
      createSource([worker], tasksByThread),
      {
        intervalMs: 60_000,
        cpuProfile: {
          eluThreshold: 0.5,
          sustainTicks: 2,
          durationMs: 1000,
          cooldownMs: 60_000,
          topN: 5,
        },
      },
    );
    await announced;

    runtimeStats.tick();
    await wait(200);
    expect(runtimeStats.tick()).to.be.undefined;
    await wait(200);
    const capture = runtimeStats.tick();
    expect(capture).to.be.a("promise");
    await capture;

    const profileCall = warnStub
      .getCalls()
      .find((call) => call.args[0] === "Hot worker thread CPU profile");
    expect(profileCall, "profile line").to.not.be.undefined;
    const payload = profileCall!.args[1];
    expect(payload.threadId).to.equal(worker.threadId);
    expect(payload.eluBefore).to.be.above(0.5);
    expect(payload.sampleCount).to.be.above(100);
    expect(payload.tasks[0]).to.deep.include({
      verificationId: "job-1",
      functionName: "verifyFromJsonInput",
      chainId: "1",
    });
    expect(payload.tasks[0].runningForMs).to.be.at.least(0);
    expect(payload.topStacks).to.not.be.empty;
    expect(payload.topSelf).to.not.be.empty;

    const exitCode = await worker.terminate();
    worker = undefined;
    expect(exitCode).to.equal(1);
  });
});
