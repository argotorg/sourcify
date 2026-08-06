import path from 'path';
import { exec } from 'child_process';
import { logDebug, logError, logSilly } from '../logger';
import type { OutputError } from '@ethereum-sourcify/compilers-types';

/**
 * Fetches a resource with an exponential timeout.
 * 1) Send req, wait backoff * 2^0 ms, abort if doesn't resolve
 * 2) Send req, wait backoff * 2^1 ms, abort if doesn't resolve
 * 3) Send req, wait backoff * 2^2 ms, abort if doesn't resolve...
 * ...
 * ...
 */
export async function fetchWithBackoff(
  resource: string,
  backoff: number = 10000,
  retries: number = 4,
) {
  let timeout = backoff;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      logSilly('Start fetchWithBackoff', { resource, timeout, attempt });
      const controller = new AbortController();
      const id = setTimeout(() => {
        logDebug('Aborting request', { resource, timeout, attempt });
        controller.abort();
      }, timeout);
      const response = await fetch(resource, {
        signal: controller.signal,
      });
      logSilly('Success fetchWithBackoff', { resource, timeout, attempt });
      clearTimeout(id);
      return response;
    } catch (error) {
      if (attempt === retries) {
        logError('Failed fetchWithBackoff', {
          resource,
          attempt,
          retries,
          timeout,
          error,
        });
        throw new Error(`Failed fetching ${resource}: ${error}`);
      } else {
        timeout *= 2; // exponential backoff
        logDebug('Retrying fetchWithBackoff', {
          resource,
          attempt,
          timeout,
          error,
        });
        continue;
      }
    }
  }
  throw new Error(`Failed fetching ${resource}`);
}

/**
 * Build a compiler artifact path under repoPath from a version-derived fileName.
 * Rejects versions/file names that could escape repoPath via path segments
 * (e.g. "0.8.28/../../../tmp/pwn"), which OpenAPI's loose CompilerVersion
 * pattern would otherwise allow.
 */
export function resolveCompilerArtifactPath(
  repoPath: string,
  fileName: string,
  version: string,
): string {
  const isUnsafePathInput = (value: string): boolean => {
    if (value.includes('\0') || value.includes('..')) {
      return true;
    }
    // Reject any path separator (POSIX or Windows), independent of host OS.
    if (value.includes('/') || value.includes('\\')) {
      return true;
    }
    if (path.basename(value) !== value) {
      return true;
    }
    return false;
  };

  if (isUnsafePathInput(version) || isUnsafePathInput(fileName)) {
    throw new Error(`Invalid compiler version: ${JSON.stringify(version)}`);
  }

  const resolvedRepo = path.resolve(repoPath);
  const resolvedPath = path.resolve(resolvedRepo, fileName);
  const repoPrefix = resolvedRepo.endsWith(path.sep)
    ? resolvedRepo
    : `${resolvedRepo}${path.sep}`;
  if (resolvedPath !== resolvedRepo && !resolvedPath.startsWith(repoPrefix)) {
    throw new Error(`Invalid compiler version: ${JSON.stringify(version)}`);
  }
  return resolvedPath;
}

export function asyncExec(
  command: string,
  inputStringified: string,
  maxBuffer: number,
): Promise<string> {
  // check if input is valid JSON. The input is untrusted and potentially cause arbitrary execution.
  JSON.parse(inputStringified);

  return new Promise((resolve, reject) => {
    const child = exec(
      command,
      {
        maxBuffer,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else if (stderr) {
          // Vyper compilers <0.4.0 outputs warnings to stderr
          // we handle this by checking if the stderr starts with "Warning:"
          if (stderr.startsWith('Warning:')) {
            resolve(stdout);
          } else {
            reject(
              new Error(`Compiler process returned with errors:\n ${stderr}`),
            );
          }
        } else {
          resolve(stdout);
        }
      },
    );
    if (!child.stdin) {
      throw new Error('No stdin on child process');
    }
    // Write input to child process's stdin
    child.stdin.write(inputStringified);
    child.stdin.end();
  });
}

export class CompilerError extends Error {
  constructor(
    message: string,
    public errors: OutputError[],
  ) {
    super(message);
  }
}
