import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import { spawnSync } from 'child_process';
import {
  findFePlatform,
  getFeExecutable,
  isFeMetadataInput,
  resolveFeSourcePath,
  useFeCompiler,
  validateFeMetadataInput,
} from '../src/lib/feCompiler';
import { CompilerError } from '../src/lib/common';
import {
  COMPILER_TIMEOUT_CODE,
  type FeJsonInput,
} from '@ethereum-sourcify/compilers-types';
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

  describe('Fe metadata input', () => {
    const metadataVersion = '26.7.0';
    const fixture = path.join(__dirname, 'fe-projects', 'heavy');

    function metadataInput(
      settings: Record<string, unknown>,
      sources: FeJsonInput['sources'] = {
        'src/lib.fe': { content: '' },
        'checks/src/lib.fe': { content: '' },
      },
    ): FeJsonInput {
      return {
        language: 'Fe',
        sources,
        settings: settings as FeJsonInput['settings'],
      };
    }

    const ingots = [
      { name: 'heavy_app', version: '1.0.0', namespace: '' },
      { name: 'checks', version: '0.2.0', namespace: 'checks' },
    ];

    function runFe(fePath: string, cwd: string, args: string[]) {
      const spawned = spawnSync(fePath, args, { cwd });
      if (spawned.status !== 0) {
        throw new Error(
          `fe ${args.join(' ')} failed: ${spawned.stderr?.toString()}`,
        );
      }
    }

    function readBytecode(dir: string, name: string) {
      return {
        creation: fs.readFileSync(path.join(dir, `${name}.bin`), 'utf8').trim(),
        runtime: fs
          .readFileSync(path.join(dir, `${name}.runtime.bin`), 'utf8')
          .trim(),
      };
    }

    it('Should tell metadata input from plain input', () => {
      expect(isFeMetadataInput(metadataInput({ ingots }))).to.be.true;
      expect(isFeMetadataInput(metadataInput({}))).to.be.false;
      for (const settings of ['invalid', 123, null, [], undefined]) {
        expect(
          isFeMetadataInput({
            language: 'Fe',
            sources: {},
            settings: settings as unknown as FeJsonInput['settings'],
          }),
          String(settings),
        ).to.be.false;
      }
    });

    it('Should accept the shape that fe build --emit metadata writes', () => {
      expect(() =>
        validateFeMetadataInput(
          metadataInput({
            ingots,
            optimizer: { level: 's' },
            compilationTarget: { 'src/lib.fe': 'Heavy' },
          }),
        ),
      ).to.not.throw();
    });

    it('Should reject metadata settings without exactly one root ingot', () => {
      expect(() =>
        validateFeMetadataInput(metadataInput({ ingots: [ingots[1]] })),
      ).to.throw('exactly one root entry');
      expect(() =>
        validateFeMetadataInput(
          metadataInput({ ingots: [ingots[0], { ...ingots[0] }] }),
        ),
      ).to.throw('exactly one root entry');
      expect(() =>
        validateFeMetadataInput(metadataInput({ ingots: [] })),
      ).to.throw('non-empty array');
    });

    it('Should reject invalid ingot namespaces', () => {
      for (const namespace of ['..', '.', 'a/b', 'src', 'x y']) {
        expect(
          () =>
            validateFeMetadataInput(
              metadataInput({
                ingots: [ingots[0], { ...ingots[1], namespace }],
              }),
            ),
          namespace,
        ).to.throw('Invalid Fe ingot namespace');
      }
    });

    it('Should reject metadata source keys outside the ingot src/ directories', () => {
      for (const key of [
        '../escape.fe',
        'src/../../escape.fe',
        'checks/../../escape.fe',
        'checks/src/../../../escape.fe',
        '/abs/src/lib.fe',
        'src/x.toml',
        'fe.toml',
        'unknown/src/lib.fe',
        'src\\lib.fe',
        'src//lib.fe',
        'checks/lib.fe',
      ]) {
        expect(
          () =>
            validateFeMetadataInput(
              metadataInput({ ingots }, { [key]: { content: '' } }),
            ),
          key,
        ).to.throw('Fe source path must be a .fe file');
      }
    });

    it('Should accept the bare source key of a standalone file', () => {
      const standalone = [{ name: 'standalone', version: null, namespace: '' }];
      expect(() =>
        validateFeMetadataInput(
          metadataInput(
            {
              ingots: standalone,
              compilationTarget: { 'counter.fe': 'Counter' },
            },
            { 'counter.fe': { content: '' } },
          ),
        ),
      ).to.not.throw();
      // Fe writes a bare key to src/<key>.
      expect(() =>
        validateFeMetadataInput(
          metadataInput(
            { ingots: standalone },
            { 'lib.fe': { content: '' }, 'src/lib.fe': { content: '' } },
          ),
        ),
      ).to.throw('name the same file');
    });

    it('Should reject a compilationTarget that is not one contract in sources', () => {
      for (const compilationTarget of [
        { 'src/lib.fe': 'A', 'checks/src/lib.fe': 'B' },
        ['Heavy'],
        'src/lib.fe:Heavy',
        { 'src/lib.fe': 1 },
      ]) {
        expect(
          () =>
            validateFeMetadataInput(
              metadataInput({ ingots, compilationTarget }),
            ),
          JSON.stringify(compilationTarget),
        ).to.throw('exactly one source path and contract name');
      }
      expect(() =>
        validateFeMetadataInput(
          metadataInput({
            ingots,
            compilationTarget: { 'src/missing.fe': 'Heavy' },
          }),
        ),
      ).to.throw('not in sources');
    });

    it('Should reject metadata input for Fe versions without --from-metadata', async () => {
      let thrown: unknown;
      try {
        await useFeCompiler(feRepoPath, version, metadataInput({ ingots }));
      } catch (error) {
        thrown = error;
      }
      expect(thrown).to.be.instanceOf(Error);
      expect((thrown as Error).message).to.include('26.3.0 or later');
    });

    // The ingot name is part of some symbols, and Sonatina orders functions by
    // symbol. So the same sources give different bytecode under another
    // ingot name (argotorg/fe#2088). The metadata input restores the name,
    // the dependency and the optimizer level of the original build.
    it('Should reproduce the bytecode of a Fe project with a dependency from its metadata', async () => {
      const platform = findFePlatform();
      if (!platform) {
        return;
      }
      const fePath = await getFeExecutable(
        feRepoPath,
        platform,
        metadataVersion,
      );
      const workDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'sourcify-fe-meta-'),
      );
      try {
        fs.cpSync(fixture, workDir, { recursive: true });
        const appDir = path.join(workDir, 'app');
        runFe(fePath, appDir, [
          'build',
          '.',
          '-O',
          's',
          '--emit',
          'bytecode,runtime-bytecode,abi,metadata',
        ]);
        const original = readBytecode(path.join(appDir, 'out'), 'Heavy');

        // The fixture must show the effect: under the name Sourcify uses
        // for plain input, the bytecode differs.
        const manifest = path.join(appDir, 'fe.toml');
        fs.writeFileSync(
          manifest,
          fs
            .readFileSync(manifest, 'utf8')
            .replace('"heavy_app"', '"sourcify_verification"'),
        );
        runFe(fePath, appDir, [
          'build',
          '.',
          '-O',
          's',
          '--out-dir',
          'renamed',
        ]);
        const renamed = readBytecode(path.join(appDir, 'renamed'), 'Heavy');
        expect(renamed.runtime).to.not.equal(original.runtime);
        // And at the default level (1) it differs too, so the match below
        // also shows that the optimizer level is restored.
        fs.writeFileSync(
          manifest,
          fs
            .readFileSync(manifest, 'utf8')
            .replace('"sourcify_verification"', '"heavy_app"'),
        );
        runFe(fePath, appDir, ['build', '.', '--out-dir', 'default-level']);
        const defaultLevel = readBytecode(
          path.join(appDir, 'default-level'),
          'Heavy',
        );
        expect(defaultLevel.runtime).to.not.equal(original.runtime);

        const metadata = JSON.parse(
          fs.readFileSync(
            path.join(appDir, 'out', 'Heavy.metadata.json'),
            'utf8',
          ),
        );
        const output = await useFeCompiler(feRepoPath, metadataVersion, {
          language: 'Fe',
          sources: metadata.sources,
          settings: metadata.settings,
        });

        const heavy = output.contracts['src/lib.fe']?.Heavy;
        expect(heavy, 'Heavy in src/lib.fe').to.not.be.undefined;
        expect(heavy.evm.bytecode.object).to.equal(original.creation);
        expect(heavy.evm.deployedBytecode.object).to.equal(original.runtime);
        expect(heavy.abi).to.be.an('array').that.is.not.empty;
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    });

    async function buildAndRebuild(
      files: Record<string, string>,
      buildTarget: string,
      artifactName: string,
    ) {
      const platform = findFePlatform();
      if (!platform) {
        return undefined;
      }
      const fePath = await getFeExecutable(
        feRepoPath,
        platform,
        metadataVersion,
      );
      const workDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'sourcify-fe-meta-'),
      );
      try {
        for (const [file, content] of Object.entries(files)) {
          fs.mkdirSync(path.dirname(path.join(workDir, file)), {
            recursive: true,
          });
          fs.writeFileSync(path.join(workDir, file), content);
        }
        runFe(fePath, workDir, [
          'build',
          buildTarget,
          '--emit',
          'bytecode,runtime-bytecode,abi,metadata',
        ]);
        const original = readBytecode(path.join(workDir, 'out'), artifactName);
        const metadata = JSON.parse(
          fs.readFileSync(
            path.join(workDir, 'out', `${artifactName}.metadata.json`),
            'utf8',
          ),
        );
        const output = await useFeCompiler(feRepoPath, metadataVersion, {
          language: 'Fe',
          sources: metadata.sources,
          settings: metadata.settings,
        });
        return { original, metadata, output };
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    }

    it('Should rebuild a standalone Fe file from its metadata', async () => {
      const result = await buildAndRebuild(
        {
          'counter.fe': `use std::evm::Ctx

pub contract Counter uses (ctx: mut Ctx) {
    mut store: Store,

    recv M {
        Bump {} -> u256 uses (mut store) {
            store.count += 1
            store.count
        }
    }
}

struct Store {
    count: u256,
}

msg M {
    #[selector = sol("bump()")]
    Bump -> u256,
}
`,
        },
        'counter.fe',
        'Counter',
      );
      if (!result) {
        return;
      }
      expect(result.metadata.settings.compilationTarget).to.deep.equal({
        'counter.fe': 'Counter',
      });
      const counter = result.output.contracts['counter.fe']?.Counter;
      expect(counter, 'Counter in counter.fe').to.not.be.undefined;
      expect(counter.evm.bytecode.object).to.equal(result.original.creation);
      expect(counter.evm.deployedBytecode.object).to.equal(
        result.original.runtime,
      );
    });

    // Two files declare `Vault`, so Fe names the artifact `lib__Vault`. The
    // contract has no ABI entries, so Fe writes no ABI file.
    it('Should key the output by compilationTarget when the artifact name differs', async () => {
      const result = await buildAndRebuild(
        {
          'fe.toml': '[ingot]\nname = "vaults"\nversion = "0.1.0"\n',
          'src/lib.fe': 'pub contract Vault {}\n',
          'src/other.fe': 'pub contract Vault {}\n',
        },
        '.',
        'lib__Vault',
      );
      if (!result) {
        return;
      }
      expect(result.metadata.settings.compilationTarget).to.deep.equal({
        'src/lib.fe': 'Vault',
      });
      expect(Object.keys(result.output.contracts)).to.deep.equal([
        'src/lib.fe',
      ]);
      const vault = result.output.contracts['src/lib.fe'].Vault;
      expect(vault, 'Vault in src/lib.fe').to.not.be.undefined;
      expect(vault.abi).to.deep.equal([]);
      expect(vault.evm.deployedBytecode.object).to.equal(
        result.original.runtime,
      );
    });
  });
});
