// Stand-in for verificationWorker.ts in tests of the task timeout. Announces
// the task like the real worker and then blocks its thread forever.
// Plain JavaScript so that the worker thread starts without ts-node.
const { parentPort, threadId, Worker } = require("node:worker_threads");

function announceTaskStart(input) {
  parentPort?.postMessage({
    type: "task-start",
    threadId,
    verificationId: input.verificationId,
  });
}

module.exports = {
  async verifyFromMetadata(input) {
    announceTaskStart(input);
    let counter = 0;
    while (true) {
      counter = (counter + 1) % 1000;
    }
  },

  async verifyFromEtherscan(input) {
    announceTaskStart(input);
    return {
      errorExport: { customCode: "no_match", errorId: "spinning-worker" },
    };
  },

  // Finishes the task but leaves a nested thread spinning, like a compiler
  // worker thread that never ends. An idle Piscina worker itself cannot run
  // anything: it blocks in Atomics.wait() until the next task.
  async verifyFromJsonInput(input) {
    announceTaskStart(input);
    new Worker(
      "let counter = 0; while (true) { counter = (counter + 1) % 1000; }",
      {
        eval: true,
      },
    ).unref();
    return {
      errorExport: { customCode: "no_match", errorId: "spinning-worker" },
    };
  },
};
