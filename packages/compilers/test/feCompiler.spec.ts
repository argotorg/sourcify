import { expect } from 'chai';
import {
  findFePlatform,
  getFeExecutable,
  resolveSafeSourcePath,
  useFeCompiler,
} from '../src/lib/feCompiler';
import { CompilerError } from '../src/lib/common';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Verify Fe Compiler', () => {
  const feRepoPath = path.join('/tmp', 'compilers-fe-repo');
  const version = '26.0.0-alpha.12';

  it('Should detect Fe platform', () => {
    const platform = findFePlatform();
    expect(platform).to.be.a('string');
    expect(platform).to.not.equal(false);
  });

  it('Should fetch Fe executable', async () => {
    const platform = findFePlatform();
    if (!platform) {
      return;
    }
    const fePath = await getFeExecutable(feRepoPath, platform, version);
    expect(fePath).to.be.a('string');
    expect(fePath).to.not.be.empty;
  });

  it('Should throw an error for an invalid Fe version', async () => {
    const platform = findFePlatform();
    if (!platform) {
      return;
    }
    try {
      await getFeExecutable(feRepoPath, platform, 'invalid-version');
      expect.fail('Expected error was not thrown');
    } catch (error) {
      expect(error).to.be.instanceOf(Error);
    }
  });

  it('Should throw for Fe versions older than minimum supported', async () => {
    try {
      await useFeCompiler(feRepoPath, '26.0.0-alpha.10', {
        language: 'Fe',
        settings: {},
        sources: { 'src/lib.fe': { content: '' } },
      });
      expect.fail('Expected error was not thrown');
    } catch (error) {
      expect(error).to.be.instanceOf(Error);
      expect((error as Error).message).to.include('not supported');
    }
  });

  it('Should compile a single-file Fe contract', async () => {
    const compiledJSON = await useFeCompiler(feRepoPath, version, {
      language: 'Fe',
      settings: {},
      sources: {
        'src/lib.fe': {
          content: `use std::abi::sol
use std::evm::{Evm, Call}
use std::evm::effects::assert

msg CounterMsg {
    #[selector = sol("increment()")]
    Increment,
    #[selector = sol("get()")]
    Get -> u256,
}

struct CounterStore {
    value: u256,
}

pub contract Counter {
    mut store: CounterStore

    init() uses (mut store) {
        store.value = 0
    }

    recv CounterMsg {
        Increment uses (mut store) {
            store.value = store.value + 1
        }

        Get -> u256 uses (store) {
            store.value
        }
    }
}`,
        },
      },
    });

    expect(compiledJSON.compiler).to.equal(`fe-${version}`);
    const counter = compiledJSON?.contracts?.['src/lib.fe']?.Counter;
    expect(counter).to.not.be.undefined;
    expect(counter.abi).to.be.an('array').that.is.not.empty;
    expect(counter.evm.bytecode.object).to.be.a('string').that.is.not.empty;
    expect(counter.evm.deployedBytecode.object).to.be.a('string').that.is.not
      .empty;
  });

  it('Should return a compiler error for invalid source', async () => {
    try {
      await useFeCompiler(feRepoPath, version, {
        language: 'Fe',
        settings: {},
        sources: {
          'src/lib.fe': {
            content: 'this is not valid Fe code',
          },
        },
      });
      expect.fail('Expected error was not thrown');
    } catch (e: any) {
      expect(e).to.be.instanceOf(CompilerError);
      expect(e.errors).to.be.an('array').that.is.not.empty;
      expect(e.errors.some((err: any) => err.severity === 'error')).to.be.true;
    }
  });

  it('Should compile a multi-file Fe ingot', async () => {
    const compiledJSON = await useFeCompiler(feRepoPath, version, {
      language: 'Fe',
      settings: {},
      sources: {
        'src/lib.fe': {
          content: 'use ingot::counter::Counter\n',
        },
        'src/counter.fe': {
          content: `use std::abi::sol
use std::evm::{Evm, Call}
use std::evm::effects::assert

msg CounterMsg {
    #[selector = sol("increment()")]
    Increment,
    #[selector = sol("get()")]
    Get -> u256,
}

struct CounterStore {
    value: u256,
}

pub contract Counter {
    mut store: CounterStore

    init() uses (mut store) {
        store.value = 0
    }

    recv CounterMsg {
        Increment uses (mut store) {
            store.value = store.value + 1
        }

        Get -> u256 uses (store) {
            store.value
        }
    }
}`,
        },
      },
    });

    const counter = compiledJSON?.contracts?.['src/counter.fe']?.Counter;
    expect(counter).to.not.be.undefined;
    expect(counter.evm.bytecode.object).to.be.a('string').that.is.not.empty;
    expect(counter.evm.deployedBytecode.object).to.be.a('string').that.is.not
      .empty;
  });

  describe('resolveSafeSourcePath', () => {
    const baseDir = path.join(os.tmpdir(), 'fe-safe-path-base');

    it('allows normal relative source paths under the base dir', () => {
      const resolved = resolveSafeSourcePath(baseDir, 'src/lib.fe');
      expect(resolved).to.equal(path.resolve(baseDir, 'src/lib.fe'));
    });

    it('allows nested relative source paths under the base dir', () => {
      const resolved = resolveSafeSourcePath(baseDir, 'src/nested/counter.fe');
      expect(resolved).to.equal(path.resolve(baseDir, 'src/nested/counter.fe'));
    });

    it('rejects absolute source paths', () => {
      expect(() => resolveSafeSourcePath(baseDir, '/tmp/evil.fe')).to.throw(
        'must be relative',
      );
    });

    it('rejects parent-directory traversal', () => {
      expect(() =>
        resolveSafeSourcePath(baseDir, 'src/../../outside.fe'),
      ).to.throw('escapes compilation directory');
    });

    it('rejects deep traversal that collapses outside the base dir', () => {
      expect(() =>
        resolveSafeSourcePath(
          baseDir,
          `src/${'../'.repeat(32)}tmp/sourcify-fe-escaped.fe`,
        ),
      ).to.throw('escapes compilation directory');
    });

    it('rejects backslash separators', () => {
      expect(() =>
        resolveSafeSourcePath(baseDir, 'src\\..\\..\\outside.fe'),
      ).to.throw('POSIX separators');
    });

    it('rejects empty and null-byte paths', () => {
      expect(() => resolveSafeSourcePath(baseDir, '')).to.throw(
        'Invalid Fe source path',
      );
      expect(() => resolveSafeSourcePath(baseDir, 'src/lib\0.fe')).to.throw(
        'Invalid Fe source path',
      );
    });
  });

  it('Should reject path-traversing source keys without writing outside tmp', async function () {
    if (!findFePlatform()) {
      this.skip();
    }

    const markerPath = path.join(
      os.tmpdir(),
      `sourcify-fe-path-traversal-${process.pid}-${Date.now()}`,
    );
    // Enough ../ segments to escape any temp directory layout.
    const traversalKey = `src/${'../'.repeat(64)}${path
      .relative(path.parse(os.tmpdir()).root, markerPath)
      .split(path.sep)
      .join('/')}`;

    expect(fs.existsSync(markerPath)).to.equal(false);

    try {
      await useFeCompiler(feRepoPath, version, {
        language: 'Fe',
        settings: {},
        sources: {
          [traversalKey]: {
            content: 'path-traversal-poc',
          },
        },
      });
      expect.fail('Expected path traversal to be rejected');
    } catch (error: any) {
      expect(error).to.be.instanceOf(Error);
      expect(error.message).to.match(
        /escapes compilation directory|must be relative|Invalid Fe source path/,
      );
    } finally {
      const leaked = fs.existsSync(markerPath);
      if (leaked) {
        fs.rmSync(markerPath, { force: true });
      }
      expect(leaked, 'traversal must not write outside the temp dir').to.equal(
        false,
      );
    }
  });
});
