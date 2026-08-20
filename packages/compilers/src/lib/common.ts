import { exec } from 'child_process';
import { logDebug, logError, logSilly } from '../logger';
import type { OutputError } from '@ethereum-sourcify/compilers-types';
import {
  COMPILER_TIMEOUT_CODE,
  COMPILER_OOM_CODE,
} from '@ethereum-sourcify/compilers-types';

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

// Default wall-clock timeout for a single compiler invocation: 45 minutes.
// A genuinely hung compiler must be killed so the verification job can fail
// instead of hanging forever (#2880). Callers override it per invocation; the
// server derives its value from COMPILER_TIMEOUT_MS.
export const DEFAULT_COMPILE_TIMEOUT_MS = 2_700_000;

// Every compile path (native subprocess, soljson worker thread, Fe spawnSync)
// reports a timeout the same way, so callers can map it to compiler_timeout.
export function createCompilerTimeoutError(timeoutMs: number): Error & {
  code?: string;
} {
  const timeoutError = new Error(
    `Compiler timed out after ${timeoutMs}ms`,
  ) as Error & { code?: string };
  timeoutError.code = COMPILER_TIMEOUT_CODE;
  return timeoutError;
}

export function asyncExec(
  command: string,
  inputStringified: string,
  maxBuffer: number,
  timeoutMs: number = DEFAULT_COMPILE_TIMEOUT_MS,
): Promise<string> {
  // check if input is valid JSON. The input is untrusted and potentially cause arbitrary execution.
  JSON.parse(inputStringified);

  return new Promise((resolve, reject) => {
    // Guard so the promise settles exactly once. Multiple failure signals can
    // race (exec callback, stdin 'error', a thrown write) and double-settling
    // would silently drop the first outcome.
    let settled = false;
    const settleResolve = (value: string) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    // A failed stdin write only tells us the pipe broke, not why the process
    // died. Record it and let the exec callback (which has the exit code and
    // signal) attribute the failure; only fall back to this if the callback
    // would otherwise report success.
    let stdinError: Error | undefined;
    const settleSuccess = (stdout: string) => {
      if (stdinError) {
        settleReject(stdinError);
        return;
      }
      settleResolve(stdout);
    };

    const child = exec(
      command,
      {
        maxBuffer,
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
      },
      (error, stdout, stderr) => {
        if (error) {
          // Attribute the death so callers can pick the right error code.
          // - Node's own timeout kill sets error.killed === true.
          // - An external kill (e.g. the OOM killer) surfaces as
          //   error.signal === 'SIGKILL' with error.killed falsy.
          const err = error as NodeJS.ErrnoException & {
            killed?: boolean;
            signal?: string;
          };
          if (err.killed) {
            settleReject(createCompilerTimeoutError(timeoutMs));
            return;
          }
          if (err.signal === 'SIGKILL') {
            const oomError = new Error(
              'Compiler process was killed (likely out of memory)',
            ) as Error & { code?: string };
            oomError.code = COMPILER_OOM_CODE;
            settleReject(oomError);
            return;
          }
          settleReject(error);
        } else if (stderr) {
          // Vyper compilers <0.4.0 outputs warnings to stderr
          // we handle this by checking if the stderr starts with "Warning:"
          if (stderr.startsWith('Warning:')) {
            settleSuccess(stdout);
          } else {
            settleReject(
              new Error(`Compiler process returned with errors:\n ${stderr}`),
            );
          }
        } else {
          settleSuccess(stdout);
        }
      },
    );
    if (!child.stdin) {
      settleReject(new Error('No stdin on child process'));
      return;
    }
    // If the compiler dies mid-write (e.g. OOM-killed while we stream a large
    // input), the stdin pipe emits 'error' (EPIPE). Without a listener this is
    // an uncaught exception in the Piscina worker thread and the compile promise
    // never rejects -> the verification job hangs forever (#2880). The listener
    // alone prevents that; the exec callback settles the promise.
    child.stdin.on('error', (err: NodeJS.ErrnoException) => {
      stdinError = new Error(
        `Failed writing input to compiler: ${err.message}`,
      );
    });
    // Write input to child process's stdin
    try {
      child.stdin.write(inputStringified);
      child.stdin.end();
    } catch (err: any) {
      stdinError = new Error(
        `Failed writing input to compiler: ${err?.message ?? err}`,
      );
    }
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
