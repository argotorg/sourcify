// TODO: Handle nodejs only dependencies
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import semver from 'semver';
import { Worker, WorkerOptions } from 'worker_threads';
import { logDebug, logError, logInfo, logWarn } from '../logger';
import { asyncExec, CompilerError, fetchWithBackoff } from './common';
import {
  SolidityJsonInput,
  SolidityOutput,
} from '@ethereum-sourcify/compilers-types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const solc = require('solc');

const HOST_SOLC_REPO = 'https://binaries.soliditylang.org/';

export function findSolcPlatform(): string | false {
  if (process.platform === 'darwin' && process.arch === 'x64') {
    return 'macosx-amd64';
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return 'linux-amd64';
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return 'windows-amd64';
  }
  return false;
}
/**
 * Searches for a solc: first for a local executable version, then from HOST_SOLC_REPO
 * and then using the getSolcJs function.
 * Once the compiler is retrieved, it is used, and the stringified solc output is returned.
 *
 * @param version the version of solc to be used for compilation
 * @param input a JSON object of the standard-json format compatible with solc
 * @param log the logger
 * @returns stringified solc output
 */

export async function useSolidityCompiler(
  solcRepoPath: string,
  solJsonRepoPath: string,
  version: string,
  solcJsonInput: SolidityJsonInput,
  forceEmscripten = false,
): Promise<SolidityOutput> {
  // For nightly builds, Solidity version is saved as 0.8.17-ci.2022.8.9+commit.6b60524c instead of 0.8.17-nightly.2022.8.9+commit.6b60524c.
  // Not possible to retrieve compilers with "-ci.".
  if (version.includes('-ci.')) version = version.replace('-ci.', '-nightly.');
  const inputStringified = JSON.stringify(solcJsonInput);
  let compiled: string | undefined;

  const solcPlatform = findSolcPlatform();
  let solcPath;
  if (solcPlatform && !forceEmscripten) {
    // Catch, if this fails we'll fall back to solc-js e.g. very early solc 0.1.4
    try {
      solcPath = await getSolcExecutable(solcRepoPath, solcPlatform, version);
    } catch (error) {
      logError('Error getting solc executable', {
        error,
        solcPlatform,
        version,
        solcRepoPath,
        solJsonRepoPath,
      });
    }
  }
  let startCompilation: number;
  if (solcPath && !forceEmscripten) {
    logInfo('Compiling with solc binary', { version, solcPath });
    startCompilation = Date.now();
    try {
      compiled = await asyncExec(
        `${solcPath} --standard-json`,
        inputStringified,
        250 * 1024 * 1024,
      );
    } catch (error: any) {
      if (error?.code === 'ENOBUFS') {
        throw new Error('Compilation output size too large');
      }
      throw error;
    }
  } else {
    logInfo('Compiling with solc-js', { version });
    const solJson = await getSolcJs(solJsonRepoPath, version);
    startCompilation = Date.now();
    if (solJson) {
      const coercedVersion =
        semver.coerce(new semver.SemVer(version))?.version ?? '';
      // Run Worker for solc versions < 0.4.0 for clean compiler context. See https://github.com/ethereum/sourcify/issues/1099
      if (semver.lt(coercedVersion, '0.4.0')) {
        compiled = await new Promise((resolve, reject) => {
          const worker = importWorker(
            path.resolve(__dirname, './compilerWorker.ts'),
            {
              workerData: { solJsonRepoPath, version, inputStringified },
            },
          );
          worker.once('message', (result) => {
            resolve(result);
          });
          worker.once('error', (error) => {
            reject(error);
          });
        });
      } else {
        compiled = solJson.compile(inputStringified);
      }
    }
  }

  const endCompilation = Date.now();
  logInfo('Local compiler - Compilation done', {
    compiler: 'solidity',
    timeInMs: endCompilation - startCompilation,
  });

  if (!compiled) {
    throw new Error('Compilation failed. No output from the compiler.');
  }
  const compiledJSON = JSON.parse(compiled) as SolidityOutput;
  const errorMessages = compiledJSON?.errors?.filter(
    (e) => e.severity === 'error',
  );
  if (errorMessages && errorMessages.length > 0) {
    logError('Compiler error', {
      errorMessages,
    });
    throw new CompilerError('Compiler error', errorMessages);
  }
  return compiledJSON;
}

export async function getSolcExecutable(
  solcRepoPath: string,
  platform: string,
  version: string,
): Promise<string | null> {
  const fileName = `solc-${platform}-v${version}`;
  const solcPath = path.join(solcRepoPath, fileName);
  if (fs.existsSync(solcPath) && validateSolcPath(solcPath)) {
    logDebug('Found existing solc', { version, platform, solcPath });
    return solcPath;
  }

  await fetchAndSaveSolc(platform, solcPath, version, fileName);
  if (!validateSolcPath(solcPath)) {
    throw new Error(
      `Solc not found. Maybe an incorrect version was provided. ${solcPath} - ${version} - ${platform}`,
    );
  }
  return solcPath;
}

function validateSolcPath(solcPath: string): boolean {
  // TODO: Handle nodejs only dependencies
  const spawned = spawnSync(solcPath, ['--version']);
  if (spawned.status === 0) {
    return true;
  }

  const error =
    spawned?.error?.message ||
    spawned.stderr.toString() ||
    'Error running solc, are you on the right platoform? (e.g. x64 vs arm)';

  logWarn(error);
  return false;
}

/**
 * Fetches a solc binary and saves it to the given path.
 *
 * If platform is "bin", it will download the solc-js binary.
 */
async function fetchAndSaveSolc(
  platform: string,
  solcPath: string,
  version: string,
  fileName: string,
): Promise<void> {
  const encodedURIFilename = encodeURIComponent(fileName);
  const githubSolcURI = `${HOST_SOLC_REPO}${platform}/${encodedURIFilename}`;
  logInfo('Fetching solc', { version, platform, githubSolcURI, solcPath });
  let res = await fetchWithBackoff(githubSolcURI);
  let status = res.status;
  let buffer;

  // handle case in which the response is a link to another version
  if (status === 200) {
    buffer = await res.arrayBuffer();
    const responseText = Buffer.from(buffer).toString();
    if (
      /^([\w-]+)-v(\d+\.\d+\.\d+)\+commit\.([a-fA-F0-9]+).*$/.test(responseText)
    ) {
      const githubSolcURI = `${HOST_SOLC_REPO}${platform}/${responseText}`;
      res = await fetchWithBackoff(githubSolcURI);
      status = res.status;
      buffer = await res.arrayBuffer();
    }
  }

  if (status === 200 && buffer) {
    fs.mkdirSync(path.dirname(solcPath), { recursive: true });

    try {
      fs.unlinkSync(solcPath);
    } catch (_e) {
      undefined;
    }
    fs.writeFileSync(solcPath, new DataView(buffer), { mode: 0o755 });
    logInfo('Saved solc', { version, platform, githubSolcURI, solcPath });
  } else {
    logError('Failed fetching solc', {
      version,
      platform,
      githubSolcURI,
      solcPath,
    });
    throw new Error(
      `Failed fetching solc ${version} for platform ${platform}. Please check if the version is valid.`,
    );
  }
}

/**
 * Fetches the requested version of the Solidity compiler (soljson).
 * First attempts to search locally; if that fails, falls back to downloading it.
 *
 * @param version the solc version to retrieve: the expected format is
 *
 * "[v]<major>.<minor>.<patch>+commit.<hash>"
 *
 * e.g.: "0.6.6+commit.6c089d02"
 *
 * defaults to "latest"
 *
 * @param log a logger to track the course of events
 *
 * @returns the requested solc instance
 */
export async function getSolcJs(
  solJsonRepoPath: string,
  version: string,
): Promise<any> {
  // /^\d+\.\d+\.\d+\+commit\.[a-f0-9]{8}$/
  version = version.trim();
  if (version !== 'latest' && !version.startsWith('v')) {
    version = 'v' + version;
  }

  const fileName = `soljson-${version}.js`;
  const solJsonPath = path.resolve(solJsonRepoPath, fileName);

  if (!fs.existsSync(solJsonPath)) {
    logDebug('Solc-js not found locally, downloading', {
      version,
      solJsonPath,
    });
    await fetchAndSaveSolc('bin', solJsonPath, version, fileName);
  }

  const solcjsImports = await import(solJsonPath);
  return solc.setupMethods(solcjsImports);
}

// https://stackoverflow.com/questions/71795469/ts-node-using-worker-thread-cause-cannot-use-import-statement-outside-a-module
function importWorker(path: string, options: WorkerOptions) {
  const resolvedPath = require.resolve(path);
  return new Worker(resolvedPath, {
    ...options,
    execArgv: /\.ts$/.test(resolvedPath)
      ? ['--require', 'ts-node/register']
      : undefined,
  });
}
