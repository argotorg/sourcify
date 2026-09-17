import { workerData, parentPort } from 'worker_threads';
import { getSolcJs } from './solidityCompiler';

async function runUseCompiler(
  solJsonRepoPath: string,
  version: string,
  inputStringified: string,
) {
  const solJson = await getSolcJs(solJsonRepoPath, version);
  const result = solJson.compile(inputStringified);
  if (parentPort === null) {
    throw new Error('Parent port is null; cannot send compilation result');
  }
  parentPort.postMessage(result);
}

runUseCompiler(
  workerData.solJsonRepoPath,
  workerData.version,
  workerData.inputStringified,
);
