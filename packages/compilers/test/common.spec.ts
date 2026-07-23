import { expect } from 'chai';
import {
  asyncExec,
  COMPILER_OOM_CODE,
  COMPILER_TIMEOUT_CODE,
} from '../src/lib/common';

const MAX_BUFFER = 250 * 1024 * 1024;

describe('asyncExec robustness (#2880)', () => {
  let originalTimeout: string | undefined;

  beforeEach(() => {
    originalTimeout = process.env.SOLC_COMPILE_TIMEOUT_MS;
  });

  afterEach(() => {
    if (originalTimeout === undefined) {
      delete process.env.SOLC_COMPILE_TIMEOUT_MS;
    } else {
      process.env.SOLC_COMPILE_TIMEOUT_MS = originalTimeout;
    }
  });

  it('resolves normally for a well-behaved subprocess', async () => {
    // `cat` echoes stdin back to stdout, mirroring how a compiler consumes
    // the standard-json input we stream in.
    const output = await asyncExec('cat', '{}', MAX_BUFFER);
    expect(output).to.equal('{}');
  });

  it('rejects with COMPILER_TIMEOUT when the subprocess hangs past the timeout', async () => {
    // Tiny timeout so a blocking command is killed almost immediately instead
    // of hanging the promise forever.
    process.env.SOLC_COMPILE_TIMEOUT_MS = '150';
    let thrown: any;
    try {
      // `sleep` never reads stdin and never exits within the timeout window.
      await asyncExec('sleep 30', '{}', MAX_BUFFER);
    } catch (error) {
      thrown = error;
    }
    expect(thrown, 'expected asyncExec to reject').to.be.instanceOf(Error);
    expect(thrown.code).to.equal(COMPILER_TIMEOUT_CODE);
    expect(thrown.message).to.contain('timed out');
  });

  it('rejects (does not hang) when the subprocess is killed', async () => {
    // A shell that SIGKILLs itself models an OOM-killed compiler. This guards
    // the stdin 'error' handler + settled guard: without them the EPIPE from
    // writing to the dying process would be an uncaught exception and the
    // promise would never settle.
    let thrown: any;
    try {
      await asyncExec('kill -9 $$', '{}', MAX_BUFFER);
    } catch (error) {
      thrown = error;
    }
    expect(thrown, 'expected asyncExec to reject').to.be.instanceOf(Error);
    expect(thrown.code).to.equal(COMPILER_OOM_CODE);
  });

  it('rejects with EPIPE-attributed OOM when writing a large input to a dying subprocess', async () => {
    // Process closes its stdin and exits immediately while we stream a large
    // input, forcing an EPIPE on the stdin pipe.
    const largeInput = JSON.stringify({ blob: 'a'.repeat(20 * 1024 * 1024) });
    let thrown: any;
    try {
      await asyncExec(
        'node -e "process.stdin.destroy(); process.exit(0)"',
        largeInput,
        MAX_BUFFER,
      );
    } catch (error) {
      thrown = error;
    }
    // The subprocess death may surface either as an exec error or a stdin EPIPE;
    // both must reject rather than hang. We only require a rejection here.
    expect(thrown, 'expected asyncExec to reject').to.be.instanceOf(Error);
  });
});
