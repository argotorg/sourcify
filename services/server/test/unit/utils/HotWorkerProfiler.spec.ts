import { expect } from "chai";
import sinon from "sinon";
import logger from "../../../src/common/logger";
import type {
  HotWorkerObservation,
  ProfilableWorker,
} from "../../../src/server/services/utils/HotWorkerProfiler";
import { HotWorkerProfiler } from "../../../src/server/services/utils/HotWorkerProfiler";
import type { RunningTaskInfo } from "../../../src/server/services/VerificationService";

const fixtureProfile = {
  nodes: [
    {
      id: 1,
      callFrame: { functionName: "(root)", url: "", lineNumber: -1 },
      children: [2],
    },
    {
      id: 2,
      callFrame: { functionName: "spin", url: "/app/dist/w.js", lineNumber: 3 },
    },
  ],
  samples: [2, 2, 2],
};

describe("HotWorkerProfiler", function () {
  const sandbox = sinon.createSandbox();
  let warnStub: sinon.SinonStub;
  let now: number;

  const options = {
    eluThreshold: 0.9,
    sustainTicks: 3,
    durationMs: 1000,
    cooldownMs: 60_000,
    topN: 5,
  };

  function createWorker(
    threadId: number,
    stop: () => Promise<string> = async () => JSON.stringify(fixtureProfile),
  ): ProfilableWorker & { startCpuProfile: sinon.SinonStub } {
    return {
      threadId,
      startCpuProfile: sandbox.stub().resolves({ stop }),
    };
  }

  function createTask(verificationId: string): RunningTaskInfo {
    return {
      verificationId,
      functionName: "verifyFromJsonInput",
      chainId: "1",
      address: "0x1234567890123456789012345678901234567890",
      startedAt: new Date(now - 5000),
      threadId: 1,
    };
  }

  function createProfiler(wait = async () => {}) {
    return new HotWorkerProfiler(options, { now: () => now, wait });
  }

  beforeEach(function () {
    now = 1_000_000;
    warnStub = sandbox.stub(logger, "warn");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("profiles a thread after sustainTicks busy ticks and logs the task", async function () {
    const profiler = createProfiler();
    const worker = createWorker(1);
    const observe = (elu: number | null): HotWorkerObservation[] => [
      { worker, elu, tasks: [createTask("job-1")] },
    ];

    expect(profiler.observe(observe(null))).to.be.undefined;
    expect(profiler.observe(observe(1))).to.be.undefined;
    expect(profiler.observe(observe(0.95))).to.be.undefined;
    const capture = profiler.observe(observe(1));
    expect(capture).to.be.a("promise");
    await capture;

    expect(worker.startCpuProfile.calledOnceWith("hot-thread-1")).to.be.true;
    expect(warnStub.calledOnce).to.be.true;
    const [message, payload] = warnStub.firstCall.args;
    expect(message).to.equal("Hot worker thread CPU profile");
    expect(payload).to.deep.include({
      threadId: 1,
      durationMs: 1000,
      eluBefore: 1,
      sampleCount: 3,
    });
    expect(payload.tasks).to.have.length(1);
    expect(payload.tasks[0]).to.deep.include({
      verificationId: "job-1",
      functionName: "verifyFromJsonInput",
      chainId: "1",
      runningForMs: 5000,
    });
    expect(payload.topSelf[0].fn).to.equal("spin");
    expect(payload.topStacks[0].stack).to.equal("spin dist/w.js:4");
  });

  it("resets the count when a tick is below the threshold", async function () {
    const profiler = createProfiler();
    const worker = createWorker(1);
    const observe = (elu: number) => [{ worker, elu, tasks: [] }];

    profiler.observe(observe(1));
    profiler.observe(observe(1));
    profiler.observe(observe(0.5));
    expect(profiler.observe(observe(1))).to.be.undefined;
    expect(profiler.observe(observe(1))).to.be.undefined;
    expect(profiler.observe(observe(1))).to.be.a("promise");
  });

  it("respects the cooldown between profiles", async function () {
    const profiler = createProfiler();
    const worker = createWorker(1);
    const observe = () => [{ worker, elu: 1, tasks: [] }];

    profiler.observe(observe());
    profiler.observe(observe());
    await profiler.observe(observe());
    expect(warnStub.callCount).to.equal(1);

    now += options.cooldownMs - 1;
    profiler.observe(observe());
    profiler.observe(observe());
    expect(profiler.observe(observe())).to.be.undefined;
    expect(profiler.observe(observe())).to.be.undefined;

    now += 1;
    await profiler.observe(observe());
    expect(warnStub.callCount).to.equal(2);
  });

  it("runs one profile at a time", async function () {
    let finishCapture!: () => void;
    const profiler = createProfiler(
      () =>
        new Promise<void>((resolve) => {
          finishCapture = resolve;
        }),
    );
    const workerA = createWorker(1);
    const workerB = createWorker(2);
    const observe = () => [
      { worker: workerA, elu: 1, tasks: [] },
      { worker: workerB, elu: 1, tasks: [] },
    ];

    profiler.observe(observe());
    profiler.observe(observe());
    const capture = profiler.observe(observe());
    expect(capture).to.be.a("promise");
    // Thread B is hot as well but a capture is in progress
    expect(profiler.observe(observe())).to.be.undefined;
    expect(workerB.startCpuProfile.called).to.be.false;

    // The capture awaits startCpuProfile before it waits for the duration
    await new Promise((resolve) => setImmediate(resolve));
    finishCapture();
    await capture;
    expect(warnStub.calledOnce).to.be.true;
    expect(warnStub.firstCall.args[1].threadId).to.equal(1);
  });

  it("logs a warning and recovers when the worker exits mid-capture", async function () {
    const profiler = createProfiler();
    const worker = createWorker(1, () =>
      Promise.reject(new Error("ERR_WORKER_NOT_RUNNING")),
    );
    const observe = () => [{ worker, elu: 1, tasks: [] }];

    profiler.observe(observe());
    profiler.observe(observe());
    await profiler.observe(observe());

    expect(warnStub.calledOnce).to.be.true;
    expect(warnStub.firstCall.args[0]).to.equal(
      "Failed to profile hot worker thread",
    );

    now += options.cooldownMs;
    profiler.observe(observe());
    profiler.observe(observe());
    expect(profiler.observe(observe())).to.be.a("promise");
  });

  it("forgets threads that disappeared", async function () {
    const profiler = createProfiler();
    const worker = createWorker(1);

    profiler.observe([{ worker, elu: 1, tasks: [] }]);
    profiler.observe([{ worker, elu: 1, tasks: [] }]);
    profiler.observe([]);
    expect(profiler.observe([{ worker, elu: 1, tasks: [] }])).to.be.undefined;
  });
});
