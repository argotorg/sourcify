import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import {
  findFePlatform,
  getFeExecutable,
  resolveFeSourcePath,
  useFeCompiler,
} from '../src/lib/feCompiler';
import { CompilerError } from '../src/lib/common';
import { COMPILER_TIMEOUT_CODE } from '@ethereum-sourcify/compilers-types';
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

  it('Should reject source paths that escape the temp compilation directory', async () => {
    let thrown: unknown;
    try {
      await useFeCompiler(feRepoPath, version, {
        language: 'Fe',
        settings: {},
        sources: {
          'src/../../../tmp/sourcify-fe-escape-probe': {
            content: 'pwned',
          },
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown, 'expected the compilation to reject').to.be.instanceOf(
      Error,
    );
    expect((thrown as Error).message).to.include(
      'must be a .fe file under src/',
    );
  });

  it('Should reject a source key that targets fe.toml', async () => {
    let thrown: unknown;
    try {
      await useFeCompiler(feRepoPath, version, {
        language: 'Fe',
        settings: {},
        sources: {
          'src/lib.fe': { content: 'pub contract Empty {}' },
          'src/../fe.toml': { content: '[ingot]\nname = "other"\n' },
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown, 'expected the compilation to reject').to.be.instanceOf(
      Error,
    );
    expect((thrown as Error).message).to.include(
      'must be a .fe file under src/',
    );
  });

  it('Should check all source keys before it writes a file', async () => {
    const written: string[] = [];
    const originalWriteFile = fs.promises.writeFile;
    fs.promises.writeFile = (async (...args: any[]) => {
      written.push(String(args[0]));
      return (originalWriteFile as any)(...args);
    }) as typeof fs.promises.writeFile;
    let thrown: unknown;
    try {
      await useFeCompiler(feRepoPath, version, {
        language: 'Fe',
        settings: {},
        sources: {
          'src/lib.fe': { content: 'pub contract Empty {}' },
          'src/../fe.toml': { content: '[ingot]\nname = "other"\n' },
        },
      });
    } catch (error) {
      thrown = error;
    } finally {
      fs.promises.writeFile = originalWriteFile;
    }
    expect(thrown).to.be.instanceOf(Error);
    expect((thrown as Error).message).to.include(
      'must be a .fe file under src/',
    );
    expect(written).to.deep.equal([]);
  });

  it('Should reject a Fe version that is not exact semver before any download', async () => {
    const repoPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'sourcify-fe-repo-'),
    );
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      throw new Error('fetch must not be called');
    }) as typeof fetch;
    try {
      for (const badVersion of [
        `${version}\t`,
        `${version}\n`,
        ` ${version}`,
        `v${version}`,
      ]) {
        let thrown: unknown;
        try {
          await useFeCompiler(repoPath, badVersion, {
            language: 'Fe',
            settings: {},
            sources: { 'src/lib.fe': { content: '' } },
          });
        } catch (error) {
          thrown = error;
        }
        expect(thrown, JSON.stringify(badVersion)).to.be.instanceOf(Error);
        expect((thrown as Error).message).to.include('not supported');
      }
      expect(fetchCalls).to.equal(0);
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  });

  it('Should resolve Fe source paths under the compilation directory', () => {
    const root = path.join(os.tmpdir(), 'sourcify-fe-jail-unit');
    const inside = resolveFeSourcePath(root, 'src/lib.fe');
    expect(inside).to.equal(path.resolve(root, 'src/lib.fe'));
    expect(() =>
      resolveFeSourcePath(root, 'src/../../../tmp/sourcify-fe-escape-probe'),
    ).to.throw('must be a .fe file under src/');
    expect(() => resolveFeSourcePath(root, 'src/..')).to.throw(
      'must be a .fe file under src/',
    );
    expect(() => resolveFeSourcePath(root, '/etc/passwd')).to.throw(
      'must be relative',
    );
  });

  it('Should only resolve .fe files under src/', () => {
    const root = path.join(os.tmpdir(), 'sourcify-fe-jail-unit');
    expect(resolveFeSourcePath(root, 'src/a/b.fe')).to.equal(
      path.resolve(root, 'src/a/b.fe'),
    );
    for (const key of [
      'src/../fe.toml',
      'src/x.toml',
      'fe.toml',
      'src/../src/../fe.toml',
      'lib.fe',
      'src',
      'src/',
    ]) {
      expect(() => resolveFeSourcePath(root, key), key).to.throw(
        'must be a .fe file under src/',
      );
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

  // fe runs through spawnSync, which blocks the thread, so only spawnSync's own
  // timeout can bound a hung compile. See #2880.
  it('Should time out a Fe compilation that exceeds the timeout', async () => {
    const platform = findFePlatform();
    if (!platform) {
      return;
    }
    let thrown: any;
    try {
      await useFeCompiler(
        feRepoPath,
        version,
        {
          language: 'Fe',
          settings: {},
          sources: {
            'src/lib.fe': {
              content: 'pub contract Empty {}',
            },
          },
        },
        1, // fe cannot even start within 1ms
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown, 'expected the compilation to reject').to.be.instanceOf(
      Error,
    );
    expect(thrown.code).to.equal(COMPILER_TIMEOUT_CODE);
  });
});
