// TODO: Handle nodejs only dependencies
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { asyncExec, CompilerError, fetchWithBackoff } from './common';
import { logDebug, logError, logInfo, logWarn } from '../logger';
import type {
  VyperJsonInput,
  VyperOutput,
} from '@ethereum-sourcify/compilers-types';
import { COMPILER_TIMEOUT_CODE } from '@ethereum-sourcify/compilers-types';
import { runIsolatedVyper } from './vyperStorageLayout';

const HOST_VYPER_REPO = 'https://github.com/vyperlang/vyper/releases/download/';
const PYTHON_ONLY_VYPER_RELEASES = new Set([
  '0.2.9',
  '0.2.10',
  '0.2.13',
  '0.2.14',
  '0.3.5',
  '0.3.10rc1',
  '0.4.0b2',
  '0.4.0b3',
]);

function hasOfficialVyperExecutable(version: string): boolean {
  return !PYTHON_ONLY_VYPER_RELEASES.has(
    version.replace(/^v/, '').split('+')[0],
  );
}

export function stringifyVyperJsonInput(
  vyperJsonInput: VyperJsonInput,
): string {
  // Keep stdin ASCII-only for locale-sensitive Vyper release binaries.
  return JSON.stringify(vyperJsonInput).replace(
    // Escape non-ASCII UTF-16 code units, including surrogate pairs.
    /[\u0080-\uFFFF]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

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
 * @param timeoutMs wall-clock limit for the vyper subprocess. Defaults to
 *   DEFAULT_COMPILE_TIMEOUT_MS.
 * @returns stringified vyper output
 */

export async function useVyperCompiler(
  vyperRepoPath: string,
  version: string,
  vyperJsonInput: VyperJsonInput,
  timeoutMs?: number,
): Promise<VyperOutput> {
  const vyperPlatform = findVyperPlatform();
  let compiled: string | undefined;
  const inputStringified = stringifyVyperJsonInput(vyperJsonInput);
  const startCompilation = Date.now();
  let vyperPath: string | undefined;
  let executableError: unknown;
  if (vyperPlatform && hasOfficialVyperExecutable(version)) {
    try {
      vyperPath = await getVyperExecutable(
        vyperRepoPath,
        vyperPlatform,
        version,
      );
    } catch (error) {
      executableError = error;
    }
  } else if (!vyperPlatform) {
    executableError = new Error('Vyper is not supported on this machine.');
  } else {
    executableError = new Error(
      `Vyper ${version} has no official executable asset`,
    );
  }

  if (vyperPath) {
    // Absolute path: asyncExec runs in a temp cwd (#2920), breaking relative paths.
    const absoluteVyperPath = path.resolve(vyperPath);
    try {
      compiled = await asyncExec(
        `${absoluteVyperPath} --standard-json`,
        inputStringified,
        250 * 1024 * 1024,
        timeoutMs,
      );
    } catch (error: any) {
      if (error?.code === 'ENOBUFS') {
        throw new Error('Compilation output size too large');
      }
      logWarn(error.message);
      throw error;
    }
  } else {
    // Some historical releases have PyPI packages but no GitHub binary assets.
    // Fall back to the same exact-version Python isolation used for layout
    // extraction.
    try {
      compiled = await runIsolatedVyper(
        vyperRepoPath,
        version,
        ['vyper', '--standard-json'],
        inputStringified,
        250 * 1024 * 1024,
        timeoutMs,
      );
      logInfo('Using isolated Python Vyper compiler', { version });
    } catch (fallbackError: any) {
      if (fallbackError?.code === COMPILER_TIMEOUT_CODE) {
        throw fallbackError;
      }
      const executableMessage =
        executableError instanceof Error
          ? executableError.message
          : String(executableError);
      throw new Error(
        `Cannot load Vyper ${version} executable (${executableMessage}) or isolated Python fallback (${fallbackError.message})`,
      );
    }
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
