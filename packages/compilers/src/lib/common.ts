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

// Machine-readable discriminators attached to the `.code` property of the
// Error thrown by asyncExec when the compiler subprocess dies. lib-sourcify
// (which cannot import this package's runtime types) reads these to map the
// failure onto a CompilationErrorCode. See AbstractCompilation.
export const COMPILER_TIMEOUT_CODE = 'COMPILER_TIMEOUT';
export const COMPILER_OOM_CODE = 'COMPILER_OOM';

// Default wall-clock timeout for a single compiler invocation: 45 minutes.
// Overridable via SOLC_COMPILE_TIMEOUT_MS. A genuinely hung compiler must be
// killed so the verification job can fail instead of hanging forever (#2880).
const DEFAULT_COMPILE_TIMEOUT_MS = 2_700_000;

function getCompileTimeoutMs(): number {
  const fromEnv = process.env.SOLC_COMPILE_TIMEOUT_MS;
  if (fromEnv) {
    const parsed = Number(fromEnv);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_COMPILE_TIMEOUT_MS;
}

export function asyncExec(
  command: string,
  inputStringified: string,
  maxBuffer: number,
): Promise<string> {
  // check if input is valid JSON. The input is untrusted and potentially cause arbitrary execution.
  JSON.parse(inputStringified);

  const timeout = getCompileTimeoutMs();

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

    const child = exec(
      command,
      {
        maxBuffer,
        timeout,
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
            const timeoutError = new Error(
              `Compiler timed out after ${timeout}ms`,
            ) as Error & { code?: string };
            timeoutError.code = COMPILER_TIMEOUT_CODE;
            settleReject(timeoutError);
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
            settleResolve(stdout);
          } else {
            settleReject(
              new Error(`Compiler process returned with errors:\n ${stderr}`),
            );
          }
        } else {
          settleResolve(stdout);
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
    // never rejects -> the verification job hangs forever (#2880). Treat it as
    // an unexpected process death (out of memory).
    child.stdin.on('error', (err: NodeJS.ErrnoException) => {
      const oomError = new Error(
        `Compiler process was killed (likely out of memory): ${err.message}`,
      ) as Error & { code?: string };
      oomError.code = COMPILER_OOM_CODE;
      settleReject(oomError);
    });
    // Write input to child process's stdin
    try {
      child.stdin.write(inputStringified);
      child.stdin.end();
    } catch (err: any) {
      const oomError = new Error(
        `Compiler process was killed (likely out of memory): ${err?.message ?? err}`,
      ) as Error & { code?: string };
      oomError.code = COMPILER_OOM_CODE;
      settleReject(oomError);
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
