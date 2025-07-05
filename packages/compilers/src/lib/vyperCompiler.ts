// TODO: Handle nodejs only dependencies
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { asyncExec, CompilerError, fetchWithBackoff } from './common';
import { logDebug, logError, logInfo, logWarn } from '../logger';
import {
  VyperJsonInput,
  VyperOutput,
} from '@ethereum-sourcify/compilers-types';

const HOST_VYPER_REPO = 'https://github.com/vyperlang/vyper/releases/download/';

export function findVyperPlatform(): string | false {
  if (
    process.platform === 'darwin' &&
    (process.arch === 'x64' || process.arch === 'arm64')
  ) {
    return 'darwin';
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return 'linux';
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return 'windows.exe';
  }
  return false;
}
/**
 * Searches for a vyper compiler: first for a local executable version, then from HOST_VYPER_REPO
 * Once the compiler is retrieved, it is used, and the stringified vyper output is returned.
 *
 * @param version the version of vyper to be used for compilation
 * @param input a JSON object of the standard-json format compatible with vyper
 * @param log the logger
 * @returns stringified vyper output
 */

export async function useVyperCompiler(
  vyperRepoPath: string,
  version: string,
  vyperJsonInput: VyperJsonInput,
): Promise<VyperOutput> {
  const vyperPlatform = findVyperPlatform();
  if (!vyperPlatform) {
    throw new Error('Vyper is not supported on this machine.');
  }

  const vyperPath = await getVyperExecutable(
    vyperRepoPath,
    vyperPlatform,
    version,
  );

  let compiled: string | undefined;
  const inputStringified = JSON.stringify(vyperJsonInput);
  const startCompilation = Date.now();
  try {
    compiled = await asyncExec(
      `${vyperPath} --standard-json`,
      inputStringified,
      250 * 1024 * 1024,
    );
  } catch (error: any) {
    if (error?.code === 'ENOBUFS') {
      throw new Error('Compilation output size too large');
    }
    logWarn(error.message);
    throw error;
  }
  const endCompilation = Date.now();
  logInfo('Local compiler - Compilation done', {
    compiler: 'vyper',
    timeInMs: endCompilation - startCompilation,
  });

  if (!compiled) {
    throw new Error('Compilation failed. No output from the compiler.');
  }
  const compiledJSON = JSON.parse(compiled) as VyperOutput;
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

export async function getVyperExecutable(
  vyperRepoPath: string,
  platform: string,
  version: string,
): Promise<string> {
  const fileName = `vyper.${version}.${platform}`;
  const vyperPath = path.join(vyperRepoPath, fileName);
  if (validateVyperPath(vyperPath)) {
    return vyperPath;
  }
  await fetchAndSaveVyper(platform, vyperPath, version, fileName);

  // Validate the vyper path
  if (!validateVyperPath(vyperPath)) {
    throw new Error(
      `Vyper not found. Maybe an incorrect version was provided. ${vyperPath} - ${version} - ${platform}`,
    );
  }
  return vyperPath;
}

function validateVyperPath(vyperPath: string): boolean {
  if (!fs.existsSync(vyperPath)) {
    logDebug('Vyper binary not found', {
      vyperPath,
    });
    return false;
  }
  // TODO: Handle nodejs only dependencies
  const spawned = spawnSync(vyperPath, ['--version']);
  if (spawned.status === 0) {
    logDebug('Found vyper binary', {
      vyperPath,
    });
    return true;
  }

  const error =
    spawned?.error?.message ||
    spawned.stderr.toString() ||
    'Error running vyper, are you on the right platform? (e.g. x64 vs arm)';

  logWarn(error);
  return false;
}

/**
 * Fetches a vyper binary and saves it to the given path.
 */
async function fetchAndSaveVyper(
  platform: string,
  vyperPath: string,
  version: string,
  fileName: string,
): Promise<void> {
  const encodedURIFilename = encodeURIComponent(fileName);
  const versionWithoutCommit = version.split('+')[0];
  const githubVyperURI = `${HOST_VYPER_REPO}v${versionWithoutCommit}/${encodedURIFilename}`;
  logDebug('Fetching vyper', {
    version,
    platform,
    vyperPath,
    githubVyperURI,
  });
  const res = await fetchWithBackoff(githubVyperURI);
  const status = res.status;
  const buffer = await res.arrayBuffer();

  if (status === 200 && buffer) {
    logDebug('Fetched vyper', { version, platform, vyperPath });
    fs.mkdirSync(path.dirname(vyperPath), { recursive: true });

    try {
      fs.unlinkSync(vyperPath);
    } catch (_e) {
      undefined;
    }
    fs.writeFileSync(vyperPath, new DataView(buffer), { mode: 0o755 });
    return;
  } else {
    logError('Failed fetching vyper', {
      version,
      platform,
      vyperPath,
      githubVyperURI,
    });
    throw new Error(
      `Failed fetching vyper ${version} for platform ${platform}. Please check if the version is valid.`,
    );
  }
}
