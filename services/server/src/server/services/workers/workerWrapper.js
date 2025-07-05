// Needed for using TypeScript for workers
const { workerData } = require("worker_threads");

if (workerData.fullpath.endsWith(".ts")) {
  require("ts-node").register();
}
module.exports = require(workerData.fullpath);
