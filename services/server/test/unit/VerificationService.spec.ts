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
  const testAddress = "0x1234567890123456789012345678901234567890";

  function createVerificationService(
    mockStorageService: any,
    options: { workerTaskTimeoutMs?: number; withS3?: boolean } = {},
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

  function getSetJobErrorArgs(mockStorageService: any) {
    const call = mockStorageService.performServiceOperation
      .getCalls()
      .find((call: any) => call.args[0] === "setJobError");
    return call?.args[1];
  }

  describe("task registry", function () {
    it("maps a thread to its running task and forgets it when the task ends", async function () {
      const verificationId = "registry-job";
      const mockStorageService = createMockStorageService(verificationId);
      verificationService = createVerificationService(mockStorageService);

      let finishTask!: (output: any) => void;
      sandbox.stub(verificationService["workerPool"], "run").returns(
        new Promise((resolve) => {
          finishTask = resolve;
        }),
      );
      const pool = verificationService["workerPool"];

      await verificationService.verifyFromEtherscanViaWorker(
        "test-endpoint",
        "1",
        testAddress,
        mockEtherscanResult,
      );

      // Not announced yet
      expect(verificationService.getRunningTasksByThread(7)).to.deep.equal([]);

      pool.emit("message", {
        type: "task-start",
        threadId: 7,
        verificationId,
      });
      const tasks = verificationService.getRunningTasksByThread(7);
      expect(tasks).to.have.length(1);
      expect(tasks[0]).to.deep.include({
        verificationId,
        functionName: "verifyFromEtherscan",
        chainId: "1",
        address: testAddress,
        threadId: 7,
      });
      expect(tasks[0].startedAt).to.be.instanceOf(Date);
      expect(tasks[0]).to.not.have.property("promise");

      // Messages that are not task messages are ignored
      pool.emit("message", { foo: "bar" });
      pool.emit("message", null);
      expect(verificationService.getRunningTasksByThread(7)).to.have.length(1);

      pool.emit("message", {
        type: "task-end",
        threadId: 7,
        verificationId,
      });
      expect(verificationService.getRunningTasksByThread(7)).to.deep.equal([]);

      // A task whose thread was terminated never sends task-end, but its
      // promise settles, which removes it from the registry
      pool.emit("message", {
        type: "task-start",
        threadId: 8,
        verificationId,
      });
      expect(verificationService.getRunningTasksByThread(8)).to.have.length(1);
      finishTask({
        errorExport: { customCode: "no_match", errorId: "test" },
      });
      await waitFor(() => !verificationService["runningTasks"].size, 1000);
      expect(verificationService.getRunningTasksByThread(8)).to.deep.equal([]);
    });

    it("close() waits for running tasks", async function () {
      const verificationId = "close-job";
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

      let closed = false;
      const closing = verificationService.close().then(() => {
        closed = true;
      });
      await wait(50);
      expect(closed).to.be.false;

      finishTask({
        errorExport: { customCode: "no_match", errorId: "test" },
      });
      await closing;
      expect(closed).to.be.true;
      expect(getSetJobErrorArgs(mockStorageService)[2].customCode).to.equal(
        "no_match",
      );
    });
  });

  describe("task timeout", function () {
    // Runs the pool with a worker that announces its task and then spins
    it("aborts a task that exceeds the timeout, fails the job with job_timeout and stores the input", async function () {
      this.timeout(30_000);
      const verificationId = "timeout-job";
      const mockStorageService = createMockStorageService(verificationId);
      sandbox
        .stub(verificationWorkerModule, "filename")
        .value(path.resolve(__dirname, "../helpers/spinningWorker.js"));
      const errorSpy: sinon.SinonSpy = sandbox.spy(logger, "error");
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

      // The worker announces the task before it starts spinning
      await waitFor(
        () =>
          verificationService
            .getWorkerThreads()
            .some(
              (thread) =>
                verificationService.getRunningTasksByThread(thread.threadId)
                  .length > 0,
            ),
        5000,
      );
      const busyThreadId = verificationService
        .getWorkerThreads()
        .map((thread) => thread.threadId)
        .find(
          (threadId) =>
            verificationService.getRunningTasksByThread(threadId).length > 0,
        )!;

      await waitFor(
        () => getSetJobErrorArgs(mockStorageService) !== undefined,
        10_000,
      );
      const setJobErrorArgs = getSetJobErrorArgs(mockStorageService);
      expect(setJobErrorArgs[0]).to.equal(verificationId);
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
      const storedInput = JSON.parse(fs.readFileSync(s3FilePath, "utf-8"));
      expect(storedInput).to.deep.include({
        verificationId,
        chainId: "1",
        address: testAddress,
      });

      // The thread was replaced and the registry cleared
      expect(verificationService["runningTasks"].size).to.equal(0);
      expect(
        verificationService.getRunningTasksByThread(busyThreadId),
      ).to.deep.equal([]);
      await waitFor(
        () =>
          !verificationService
            .getWorkerThreads()
            .some((thread) => thread.threadId === busyThreadId),
        2000,
      );

      // The pool still runs tasks
      const nextVerificationId = "next-job";
      mockStorageService.performServiceOperation
        .withArgs("storeVerificationJob")
        .resolves(nextVerificationId);
      await verificationService.verifyFromEtherscanViaWorker(
        "test-endpoint",
        "1",
        testAddress,
        mockEtherscanResult,
      );
      await waitFor(
        () =>
          mockStorageService.performServiceOperation
            .getCalls()
            .some(
              (call: any) =>
                call.args[0] === "setJobError" &&
                call.args[1][0] === nextVerificationId,
            ),
        5000,
      );
      const nextArgs = mockStorageService.performServiceOperation
        .getCalls()
        .find(
          (call: any) =>
            call.args[0] === "setJobError" &&
            call.args[1][0] === nextVerificationId,
        ).args[1];
      expect(nextArgs[2]).to.deep.include({ customCode: "no_match" });
    });

    it("does not pass a signal to the pool when the timeout is disabled", async function () {
      const verificationId = "no-timeout-job";
      const mockStorageService = createMockStorageService(verificationId);
      verificationService = createVerificationService(mockStorageService, {
        workerTaskTimeoutMs: 0,
      });
      const runStub = sandbox
        .stub(verificationService["workerPool"], "run")
        .resolves({
          errorExport: { customCode: "no_match", errorId: "test" },
        });

      await verificationService.verifyFromEtherscanViaWorker(
        "test-endpoint",
        "1",
        testAddress,
        mockEtherscanResult,
      );
      await waitFor(() => !verificationService["runningTasks"].size, 1000);

      expect(runStub.calledOnce).to.be.true;
      expect(runStub.firstCall.args[0]).to.deep.include({ verificationId });
      expect(runStub.firstCall.args[1]).to.deep.equal({
        name: "verifyFromEtherscan",
        signal: undefined,
      });
    });

    it("passes a timeout signal to the pool when enabled", async function () {
      const verificationId = "signal-job";
      const mockStorageService = createMockStorageService(verificationId);
      verificationService = createVerificationService(mockStorageService, {
        workerTaskTimeoutMs: 60_000,
      });
      const runStub = sandbox
        .stub(verificationService["workerPool"], "run")
        .resolves({
          errorExport: { customCode: "no_match", errorId: "test" },
        });

      await verificationService.verifyFromEtherscanViaWorker(
        "test-endpoint",
        "1",
        testAddress,
        mockEtherscanResult,
      );
      await waitFor(() => !verificationService["runningTasks"].size, 1000);

      expect(runStub.firstCall.args[1]?.signal).to.be.instanceOf(AbortSignal);
    });
  });
});
