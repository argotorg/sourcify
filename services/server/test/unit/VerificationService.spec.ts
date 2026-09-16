import { VerificationService } from "../../src/server/services/VerificationService";
import nock from "nock";
import fs from "fs";
import path from "path";
import { expect } from "chai";
import { findSolcPlatform } from "@ethereum-sourcify/compilers";
import config from "config";
import { rimrafSync } from "rimraf";
import { StorageService } from "../../src/server/services/StorageService";
import { RWStorageIdentifiers } from "../../src/server/services/storageServices/identifiers";
import sinon from "sinon";
import type { EtherscanResult } from "@ethereum-sourcify/lib-sourcify";
import { testS3Bucket, testS3Path } from "../helpers/S3ClientMock";
import { MockVerificationExport } from "../helpers/mocks";
import * as verificationWorkerModule from "../../src/server/services/workers/verificationWorker";
import logger from "../../src/common/logger";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, timeoutMs: number) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Condition not met in time");
    }
    await wait(20);
  }
}

describe("VerificationService", function () {
  const sandbox = sinon.createSandbox();
  let verificationService: VerificationService;

  beforeEach(function () {
    // Clear any previously nocked interceptors
    nock.cleanAll();
    rimrafSync(path.join(testS3Path, testS3Bucket));
  });

  afterEach(async function () {
    // Ensure that all nock interceptors have been used
    nock.isDone();
    sandbox.restore();
    // Destroy the Piscina worker pool to free memory
    if (verificationService) {
      await verificationService.close();
    }
  });

  after(() => {
    rimrafSync(path.join(testS3Path, testS3Bucket));
  });

  function createMockStorageService(testVerificationId: string) {
    const mockStorageService = {
      performServiceOperation: sandbox.stub(),
    } as any;

    mockStorageService.performServiceOperation
      .withArgs("storeVerificationJob")
      .resolves(testVerificationId);

    mockStorageService.performServiceOperation
      .withArgs("setJobError")
      .resolves();

    return mockStorageService;
  }

  function mockWorkerPoolError(verificationService: VerificationService) {
    const workerPoolStub = sandbox.stub(
      verificationService["workerPool"],
      "run",
    );
    workerPoolStub.rejects(new Error("Worker pool error"));
    return workerPoolStub;
  }

  it("should initialize compilers", async function () {
    rimrafSync(config.get("solcRepo"));
    rimrafSync(config.get("solJsonRepo"));

    const platform = findSolcPlatform() || "bin";
    const HOST_SOLC_REPO = "https://binaries.soliditylang.org";

    // Mock the list of solc versions to not download every single
    let releases: Record<string, string>;
    if (platform === "bin") {
      releases = {
        "0.8.26": "soljson-v0.8.26+commit.8a97fa7a.js",
        "0.6.12": "soljson-v0.6.12+commit.27d51765.js",
      };
      nock(HOST_SOLC_REPO, { allowUnmocked: true })
        .get("/bin/list.json")
        .reply(200, {
          releases,
        });
    } else if (platform === "macosx-amd64") {
      releases = {
        "0.8.26": "solc-macosx-amd64-v0.8.26+commit.8a97fa7a",
        "0.6.12": "solc-macosx-amd64-v0.6.12+commit.27d51765",
        "0.4.10": "solc-macosx-amd64-v0.4.10+commit.f0d539ae",
      };
      nock(HOST_SOLC_REPO, { allowUnmocked: true })
        .get("/macosx-amd64/list.json")
        .reply(200, {
          releases,
        });
    } else {
      releases = {
        "0.8.26": "solc-linux-amd64-v0.8.26+commit.8a97fa7a",
        "0.6.12": "solc-linux-amd64-v0.6.12+commit.27d51765",
        "0.4.10": "solc-linux-amd64-v0.4.10+commit.9e8cc01b",
      };
      nock(HOST_SOLC_REPO, { allowUnmocked: true })
        .get("/linux-amd64/list.json")
        .reply(200, {
          releases,
        });
    }

    verificationService = new VerificationService(
      {
        initCompilers: true,
        sourcifyChainMap: {},
        solcRepoPath: config.get("solcRepo"),
        solJsonRepoPath: config.get("solJsonRepo"),
        vyperRepoPath: config.get("vyperRepo"),
        feRepoPath: config.get("feRepo"),
      },
      new StorageService({
        enabledServices: {
          read: RWStorageIdentifiers.RepositoryV1,
          writeOrWarn: [],
          writeOrErr: [],
        },
        serverUrl: "http://localhost",
        repositoryV1ServiceOptions: {
          repositoryPath: config.get("repositoryV1.path"),
        },
      }),
    );

    // Call the init method to trigger the download
    await verificationService.init();

    // Check if the files exist in the expected directory
    const downloadDir =
      platform === "bin"
        ? config.get<string>("solJsonRepo")
        : config.get<string>("solcRepo");

    Object.values(releases).forEach((release) => {
      expect(fs.existsSync(path.join(downloadDir, release))).to.be.true;
    });
  });

  it("should handle workerPool.run errors and set job error as internal_error", async function () {
    const verificationId = "test-verification-id";
    const mockStorageService = createMockStorageService(verificationId);

    verificationService = new VerificationService(
      {
        initCompilers: false,
        sourcifyChainMap: {},
        solcRepoPath: config.get("solcRepo"),
        solJsonRepoPath: config.get("solJsonRepo"),
        vyperRepoPath: config.get("vyperRepo"),
        feRepoPath: config.get("feRepo"),
      },
      mockStorageService,
    );

    mockWorkerPoolError(verificationService);

    const mockEtherscanResult: EtherscanResult = {
      ContractName: "TestContract",
      SourceCode: "contract TestContract {}",
      ABI: "[]",
      CompilerVersion: "v0.8.26+commit.8a97fa7a",
      OptimizationUsed: "0",
      Runs: "200",
      ConstructorArguments: "",
      EVMVersion: "default",
      Library: "",
      LicenseType: "",
      Proxy: "0",
      Implementation: "",
      SwarmSource: "",
    };

    // Call the method that should handle worker errors
    verificationService.verifyFromEtherscanViaWorker(
      "test-endpoint",
      "1",
      "0x1234567890123456789012345678901234567890",
      mockEtherscanResult,
    );

    // Wait for the async task to complete
    await new Promise((resolve) => setTimeout(resolve, 1));

    // Verify the job error was set with internal_error
    const setJobErrorCall = mockStorageService.performServiceOperation
      .getCalls()
      .find((call: any) => call.args[0] === "setJobError");
    expect(setJobErrorCall).to.not.be.undefined;

    // The setJobError call has args: ["setJobError", [verificationId, Date, errorExport]]
    const setJobErrorArgs = setJobErrorCall.args[1];
    expect(setJobErrorArgs[0]).to.equal(verificationId);
    expect(setJobErrorArgs[1]).to.be.instanceOf(Date);
    expect(setJobErrorArgs[2]).to.deep.include({
      customCode: "internal_error",
    });
    expect(setJobErrorArgs[2].errorId).to.be.a("string");
  });

  it("should store verification input data to S3 after failed verification", async function () {
    const verificationId = "test-verification-id-s3";
    const mockStorageService = createMockStorageService(verificationId);

    verificationService = new VerificationService(
      {
        initCompilers: false,
        sourcifyChainMap: {},
        solcRepoPath: config.get("solcRepo"),
        solJsonRepoPath: config.get("solJsonRepo"),
        vyperRepoPath: config.get("vyperRepo"),
        feRepoPath: config.get("feRepo"),
        debugDataS3Config: {
          bucket: testS3Bucket,
          region: "test-region",
          accessKeyId: "test-key",
          secretAccessKey: "test-secret",
        },
      },
      mockStorageService,
    );

    mockWorkerPoolError(verificationService);

    verificationService.verifyFromMetadataViaWorker(
      "test-endpoint",
      "1",
      "0x1234567890123456789012345678901234567890",
      MockVerificationExport.compilation.metadata!,
      MockVerificationExport.compilation.sources,
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const s3FilePath = path.join(
      testS3Path,
      testS3Bucket,
      "failed-verification-inputs",
      `${verificationId}.json`,
    );

    expect(fs.existsSync(s3FilePath)).to.be.true;

    const storedData = JSON.parse(fs.readFileSync(s3FilePath, "utf-8"));
    expect(storedData).to.deep.include({
      chainId: "1",
      address: "0x1234567890123456789012345678901234567890",
    });
    expect(storedData.metadata).to.deep.equal(
      MockVerificationExport.compilation.metadata,
    );
    expect(storedData.sources).to.deep.equal(
      MockVerificationExport.compilation.sources,
    );
  });

  it("should not throw if S3 storage fails during failed verification", async function () {
    const verificationId = "test-verification-id-s3-fail";
    const mockStorageService = createMockStorageService(verificationId);

    verificationService = new VerificationService(
      {
        initCompilers: false,
        sourcifyChainMap: {},
        solcRepoPath: config.get("solcRepo"),
        solJsonRepoPath: config.get("solJsonRepo"),
        vyperRepoPath: config.get("vyperRepo"),
        feRepoPath: config.get("feRepo"),
        debugDataS3Config: {
          bucket: testS3Bucket,
          region: "test-region",
          accessKeyId: "test-key",
          secretAccessKey: "test-secret",
        },
      },
      mockStorageService,
    );

    mockWorkerPoolError(verificationService);

    const s3ClientStub = sandbox.stub(
      verificationService["debugDataS3Client"]!,
      "send",
    );
    s3ClientStub.rejects(new Error("S3 storage error"));

    verificationService.verifyFromMetadataViaWorker(
      "test-endpoint",
      "1",
      "0x1234567890123456789012345678901234567890",
      MockVerificationExport.compilation.metadata!,
      MockVerificationExport.compilation.sources,
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const setJobErrorCall = mockStorageService.performServiceOperation
      .getCalls()
      .find((call: any) => call.args[0] === "setJobError");
    expect(setJobErrorCall).to.not.be.undefined;
    expect(s3ClientStub.called).to.be.true;
  });

  const testAddress = "0x1234567890123456789012345678901234567890";
  const mockEtherscanResult: EtherscanResult = {
    ContractName: "TestContract",
    SourceCode: "contract TestContract {}",
    ABI: "[]",
    CompilerVersion: "v0.8.26+commit.8a97fa7a",
    OptimizationUsed: "0",
    Runs: "200",
    ConstructorArguments: "",
    EVMVersion: "default",
    Library: "",
    LicenseType: "",
    Proxy: "0",
    Implementation: "",
    SwarmSource: "",
  };

  function createVerificationService(
    mockStorageService: any,
    options: {
      workerTaskTimeoutMs?: number;
      runtimeStatsIntervalMs?: number;
      withS3?: boolean;
    } = {},
  ) {
    return new VerificationService(
      {
        initCompilers: false,
        sourcifyChainMap: {},
        solcRepoPath: config.get("solcRepo"),
        solJsonRepoPath: config.get("solJsonRepo"),
        vyperRepoPath: config.get("vyperRepo"),
        feRepoPath: config.get("feRepo"),
        workerTaskTimeoutMs: options.workerTaskTimeoutMs,
        runtimeStatsIntervalMs: options.runtimeStatsIntervalMs,
        debugDataS3Config: options.withS3
          ? {
              bucket: testS3Bucket,
              region: "test-region",
              accessKeyId: "test-key",
              secretAccessKey: "test-secret",
            }
          : undefined,
      },
      mockStorageService,
    );
  }

  function getSetJobErrorArgs(mockStorageService: any, verificationId: string) {
    const call = mockStorageService.performServiceOperation
      .getCalls()
      .find(
        (call: any) =>
          call.args[0] === "setJobError" && call.args[1][0] === verificationId,
      );
    return call?.args[1];
  }

  it("should keep track of running tasks and wait for them in close()", async function () {
    const verificationId = "running-job";
    const mockStorageService = createMockStorageService(verificationId);
    verificationService = createVerificationService(mockStorageService);

    let finishTask!: (output: any) => void;
    sandbox.stub(verificationService["workerPool"], "run").returns(
      new Promise((resolve) => {
        finishTask = resolve;
      }),
    );
    await verificationService.verifyFromEtherscanViaWorker(
      "test-endpoint",
      "1",
      testAddress,
      mockEtherscanResult,
    );

    const task = verificationService["runningTasks"].get(verificationId)!;
    expect(task).to.deep.include({
      verificationId,
      functionName: "verifyFromEtherscan",
      chainId: "1",
      address: testAddress,
    });
    expect(task.threadId).to.be.undefined;

    verificationService["workerPool"].emit("message", {
      type: "task-start",
      threadId: 7,
      verificationId,
    });
    expect(task.threadId).to.equal(7);

    let closed = false;
    const closing = verificationService.close().then(() => {
      closed = true;
    });
    await wait(50);
    expect(closed).to.be.false;

    finishTask({ errorExport: { customCode: "no_match", errorId: "test" } });
    await closing;
    expect(verificationService["runningTasks"].size).to.equal(0);
    expect(
      getSetJobErrorArgs(mockStorageService, verificationId)[2].customCode,
    ).to.equal("no_match");
  });

  // Runs the pool with a worker that announces its task and then spins
  it("should terminate a task that exceeds the timeout, fail the job with job_timeout and store the input", async function () {
    this.timeout(30_000);
    const verificationId = "timeout-job";
    const mockStorageService = createMockStorageService(verificationId);
    sandbox
      .stub(verificationWorkerModule, "filename")
      .value(path.resolve(__dirname, "../helpers/spinningWorker.js"));
    const errorSpy: sinon.SinonSpy = sandbox.spy(logger, "error");
    const infoSpy: sinon.SinonSpy = sandbox.spy(logger, "info");
    verificationService = createVerificationService(mockStorageService, {
      workerTaskTimeoutMs: 2000,
      withS3: true,
    });

    await verificationService.verifyFromMetadataViaWorker(
      "test-endpoint",
      "1",
      testAddress,
      MockVerificationExport.compilation.metadata!,
      MockVerificationExport.compilation.sources,
    );

    const task = verificationService["runningTasks"].get(verificationId)!;
    await waitFor(() => task.threadId !== undefined, 5000);
    const busyThreadId = task.threadId!;

    // The stats line lists the busy thread with its task
    verificationService["logRuntimeStats"]();
    await wait(300);
    verificationService["logRuntimeStats"]();
    const statsCalls = infoSpy
      .getCalls()
      .filter((call) => call.args[0] === "Worker runtime stats");
    expect(statsCalls).to.have.length(2);
    expect(statsCalls[0].args[1].workers[0].elu).to.be.null;
    const stats = statsCalls[1].args[1];
    expect(stats.workers).to.have.length(1);
    expect(stats.workers[0].threadId).to.equal(busyThreadId);
    expect(stats.workers[0].elu).to.be.above(0.9);
    expect(stats.workers[0].tasks[0]).to.deep.include({
      verificationId,
      functionName: "verifyFromMetadata",
      chainId: "1",
      address: testAddress,
    });
    expect(stats.pool.threads).to.be.above(0);
    expect(stats.cpu.userMs).to.be.at.least(0);
    expect(stats.rss).to.be.above(0);

    await waitFor(
      () =>
        getSetJobErrorArgs(mockStorageService, verificationId) !== undefined,
      10_000,
    );
    const setJobErrorArgs = getSetJobErrorArgs(
      mockStorageService,
      verificationId,
    );
    expect(setJobErrorArgs[2]).to.deep.include({ customCode: "job_timeout" });

    const timeoutLog = errorSpy
      .getCalls()
      .find((call) => call.args[0] === "Verification worker task timed out");
    expect(timeoutLog, "timeout log line").to.not.be.undefined;
    expect(timeoutLog!.args[1]).to.deep.include({
      verificationId,
      functionName: "verifyFromMetadata",
      chainId: "1",
      address: testAddress,
      timeoutMs: 2000,
      threadId: busyThreadId,
    });

    // The input is stored like for any other failed job
    const s3FilePath = path.join(
      testS3Path,
      testS3Bucket,
      "failed-verification-inputs",
      `${verificationId}.json`,
    );
    await waitFor(() => fs.existsSync(s3FilePath), 2000);
    expect(JSON.parse(fs.readFileSync(s3FilePath, "utf-8"))).to.deep.include({
      verificationId,
      chainId: "1",
      address: testAddress,
    });

    // The thread was replaced and the pool still runs tasks
    expect(verificationService["runningTasks"].size).to.equal(0);
    await waitFor(
      () =>
        !verificationService["workerPool"].threads.some(
          (thread) => thread.threadId === busyThreadId,
        ),
      2000,
    );
    const nextVerificationId = "next-job";
    mockStorageService.performServiceOperation
      .withArgs("storeVerificationJob")
      .resolves(nextVerificationId);
    await verificationService.verifyFromJsonInputViaWorker(
      "test-endpoint",
      "1",
      testAddress,
      { language: "Solidity", sources: {}, settings: {} } as any,
      "0.8.26+commit.8a97fa7a",
      { path: "test.sol", name: "Test" },
    );
    await waitFor(
      () =>
        getSetJobErrorArgs(mockStorageService, nextVerificationId) !==
        undefined,
      5000,
    );
    expect(
      getSetJobErrorArgs(mockStorageService, nextVerificationId)[2],
    ).to.deep.include({ customCode: "no_match" });
  });

  it("should log a warning when the timed out thread cannot be terminated", async function () {
    const verificationId = "terminate-fails-job";
    const mockStorageService = createMockStorageService(verificationId);
    const warnSpy: sinon.SinonSpy = sandbox.spy(logger, "warn");
    verificationService = createVerificationService(mockStorageService, {
      workerTaskTimeoutMs: 50,
    });
    let rejectRun!: (error: Error) => void;
    sandbox.stub(verificationService["workerPool"], "run").returns(
      new Promise((_, reject) => {
        rejectRun = reject;
      }),
    );
    const worker = verificationService["workerPool"].threads[0];
    sandbox.stub(worker, "terminate").rejects(new Error("terminate failed"));

    await verificationService.verifyFromEtherscanViaWorker(
      "test-endpoint",
      "1",
      testAddress,
      mockEtherscanResult,
    );
    verificationService["workerPool"].emit("message", {
      type: "task-start",
      threadId: worker.threadId,
      verificationId,
    });

    await waitFor(
      () =>
        warnSpy
          .getCalls()
          .some(
            (call) =>
              call.args[0] === "Failed to terminate timed out worker thread",
          ),
      2000,
    );
    const warnLog = warnSpy
      .getCalls()
      .find(
        (call) =>
          call.args[0] === "Failed to terminate timed out worker thread",
      )!;
    expect(warnLog.args[1]).to.deep.include({
      verificationId,
      threadId: worker.threadId,
    });

    // Piscina rejects the task once the thread is gone
    rejectRun(new Error("worker exited with code: 1"));
    await waitFor(
      () =>
        getSetJobErrorArgs(mockStorageService, verificationId) !== undefined,
      2000,
    );
    expect(
      getSetJobErrorArgs(mockStorageService, verificationId)[2],
    ).to.deep.include({ customCode: "job_timeout" });
  });

  // Runs the pool with a worker that finishes its task and leaves a nested thread spinning
  it("should report CPU outside of running tasks in the stats line", async function () {
    this.timeout(30_000);
    const verificationId = "spin-after-job";
    const mockStorageService = createMockStorageService(verificationId);
    sandbox
      .stub(verificationWorkerModule, "filename")
      .value(path.resolve(__dirname, "../helpers/spinningWorker.js"));
    const infoSpy: sinon.SinonSpy = sandbox.spy(logger, "info");
    verificationService = createVerificationService(mockStorageService);

    await verificationService.verifyFromJsonInputViaWorker(
      "test-endpoint",
      "1",
      testAddress,
      { language: "Solidity", sources: {}, settings: {} } as any,
      "0.8.26+commit.8a97fa7a",
      { path: "test.sol", name: "Test" },
    );
    await waitFor(
      () =>
        getSetJobErrorArgs(mockStorageService, verificationId) !== undefined,
      5000,
    );
    expect(verificationService["runningTasks"].size).to.equal(0);

    verificationService["logRuntimeStats"]();
    await wait(500);
    verificationService["logRuntimeStats"]();
    const stats = infoSpy
      .getCalls()
      .filter((call) => call.args[0] === "Worker runtime stats")[1].args[1];
    expect(stats.workers).to.deep.equal([]);
    expect(stats.pool.threadsWithoutTask).to.be.at.least(1);
    expect(stats.pool.threadsWithoutTask).to.equal(stats.pool.threads);
    expect(stats.main.elu).to.be.below(0.5);
    expect(stats.cpu.taskElu).to.equal(0);
    expect(stats.cpu.cores).to.be.above(0.5);
    expect(stats.cpu.outsideLoops).to.be.above(0.5);
  });

  it("should report a busy main thread in the stats line", async function () {
    const mockStorageService = createMockStorageService("no-job");
    const infoSpy: sinon.SinonSpy = sandbox.spy(logger, "info");
    verificationService = createVerificationService(mockStorageService, {
      runtimeStatsIntervalMs: 60_000,
    });
    verificationService["logRuntimeStats"]();

    // A loop of short callbacks keeps the main thread busy for 300 ms
    const loopEnd = Date.now() + 300;
    await new Promise<void>((resolve) => {
      const loop = () =>
        Date.now() < loopEnd ? setImmediate(loop) : resolve();
      loop();
    });
    verificationService["logRuntimeStats"]();

    const stats = infoSpy
      .getCalls()
      .filter((call) => call.args[0] === "Worker runtime stats")[1].args[1];
    expect(stats.main.elu).to.be.above(0.9);
    expect(stats.main.loopDelayP99Ms).to.be.below(50);
    expect(stats.cpu.cores).to.be.above(0.5);
  });
});
