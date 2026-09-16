// Stand-in for verificationWorker.ts in tests of the task timeout. Announces
// the task like the real worker and then blocks its thread forever.
// Plain JavaScript so that the worker thread starts without ts-node.
const { parentPort, threadId } = require("node:worker_threads");

function announce(type, verificationId) {
  parentPort?.postMessage({ type, threadId, verificationId });
}

module.exports = {
  async verifyFromMetadata(input) {
    announce("task-start", input.verificationId);
    let counter = 0;
    while (true) {
      counter = (counter + 1) % 1000;
    }
  },

  async verifyFromEtherscan(input) {
    announce("task-start", input.verificationId);
    try {
      return {
        errorExport: { customCode: "no_match", errorId: "spinning-worker" },
      };
    } finally {
      announce("task-end", input.verificationId);
    }
  },
};
