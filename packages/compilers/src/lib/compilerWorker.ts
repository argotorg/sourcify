import { writeFileSync } from 'fs';
import { workerData, parentPort } from 'worker_threads';
import { getSolcJs } from './solidityCompiler';

function setThreadName(name: string) {
  try {
    writeFileSync('/proc/thread-self/comm', name.slice(0, 15));
  } catch {
    // Not Linux or not permitted. The name is only a diagnostic aid.
  }
}

// e.g. solcjs-0.4.11
setThreadName(`solcjs-${String(workerData.version).split('+')[0]}`);

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
