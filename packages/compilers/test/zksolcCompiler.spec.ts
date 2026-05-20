import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  findEraSolcPlatform,
  findZkSolcPlatform,
  getEraSolcExecutable,
  getZkSolcBaseSolcExecutable,
  getZkSolcExecutable,
  getZkSolcStandardJsonArgs,
  isZkSolcVersionAtLeastV15,
  normalizeEraSolcVersion,
  normalizeZkSolcVersion,
  useZkSolcCompiler,
} from '../src/lib/zksolcCompiler';
import * as commonModule from '../src/lib/common';
import * as solidityCompilerModule from '../src/lib/solidityCompiler';
import type { SolidityJsonInput } from '@ethereum-sourcify/compilers-types';

// Writes a minimal POSIX executable so validateCompilerPath's `--version`
// check succeeds without downloading a real compiler.
function writeFakeCompilerBinary(repoPath: string, fileName: string): string {
  fs.mkdirSync(repoPath, { recursive: true });
  const compilerPath = path.join(repoPath, fileName);
  fs.writeFileSync(compilerPath, '#!/bin/sh\nprintf "fake compiler\\n"\n', {
    mode: 0o755,
  });
  return compilerPath;
}

describe('Verify zksolc compiler plumbing', () => {
  const zksolcRepoPath = path.join('/tmp', 'compilers-zksolc-repo');
  const eraSolcRepoPath = path.join('/tmp', 'compilers-era-solc-repo');
  const zksolcVersion = '1.5.16';
  const eraSolcVersion = '0.8.30-1.0.2';

  function writeExecutable(repoPath: string, fileName: string) {
    fs.mkdirSync(repoPath, { recursive: true });
    const compilerPath = path.join(repoPath, fileName);
    fs.writeFileSync(
      compilerPath,
      '#!/bin/sh\nprintf "test compiler version\\n"\n',
      { mode: 0o755 },
    );
    return compilerPath;
  }

  it('normalizes zkSync compiler versions', () => {
    expect(normalizeZkSolcVersion('1.5.16')).to.equal('v1.5.16');
    expect(normalizeZkSolcVersion('v1.5.16')).to.equal('v1.5.16');
    expect(normalizeZkSolcVersion('vm-1.5.0-a167aa3')).to.equal(
      'vm-1.5.0-a167aa3',
    );
    expect(normalizeEraSolcVersion('0.8.30-1.0.2')).to.equal('0.8.30-1.0.2');
    expect(normalizeEraSolcVersion('zkVM-0.8.19-1.0.0')).to.equal(
      '0.8.19-1.0.0',
    );
    expect(isZkSolcVersionAtLeastV15('v1.5.0')).to.equal(true);
    expect(isZkSolcVersionAtLeastV15('1.4.1')).to.equal(false);
    expect(isZkSolcVersionAtLeastV15('vm-1.5.0-a167aa3')).to.equal(false);
  });

  it('Should throw an error if zksolc is not found', async () => {
    try {
      await getZkSolcExecutable(
        zksolcRepoPath,
        'linux-amd64-gnu',
        'invalid-version',
      );
      expect.fail('Expected error was not thrown');
    } catch (error) {
      expect(error).to.be.instanceOf(Error);
    }
  });

  it('Should throw an error if EraVM solc is not found', async () => {
    try {
      await getEraSolcExecutable(
        eraSolcRepoPath,
        'linux-amd64',
        'invalid-version',
      );
      expect.fail('Expected error was not thrown');
    } catch (error) {
      expect(error).to.be.instanceOf(Error);
    }
  });

  it('finds cached zksolc binaries and falls back to linux musl names', async function () {
    if (process.platform === 'win32') this.skip();

    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'zksolc-test-'));
    const compilerPath = writeExecutable(
      repoPath,
      'zksolc-linux-amd64-musl-v1.4.0',
    );

    try {
      expect(
        await getZkSolcExecutable(repoPath, 'linux-amd64-gnu', '1.4.0'),
      ).to.equal(compilerPath);
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  });

  it('finds cached EraVM solc binaries', async function () {
    if (process.platform === 'win32') this.skip();

    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'era-solc-test-'));
    const compilerPath = writeExecutable(
      repoPath,
      'solc-linux-amd64-0.8.30-1.0.2',
    );

    try {
      expect(
        await getEraSolcExecutable(
          repoPath,
          'linux-amd64',
          'zkVM-0.8.30-1.0.2',
        ),
      ).to.equal(compilerPath);
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  });

  if (findZkSolcPlatform() && findEraSolcPlatform()) {
    it('Should fetch zksolc from GitHub', async () => {
      expect(
        await getZkSolcExecutable(
          zksolcRepoPath,
          findZkSolcPlatform() as string,
          zksolcVersion,
        ),
      ).not.equals(null);
    });

    it('Should fetch EraVM solc from GitHub', async () => {
      expect(
        await getEraSolcExecutable(
          eraSolcRepoPath,
          findEraSolcPlatform() as string,
          eraSolcVersion,
        ),
      ).not.equals(null);
    });

    it('Should compile with zksolc', async () => {
      try {
        const compiledJSON = await useZkSolcCompiler(
          zksolcRepoPath,
          eraSolcRepoPath,
          zksolcVersion,
          eraSolcVersion,
          {
            language: 'Solidity',
            sources: {
              'test.sol': {
                content: 'contract C { function f() public {} }',
              },
            },
            settings: {
              optimizer: {
                enabled: false,
              },
              outputSelection: {
                '*': {
                  '*': ['abi', 'evm'],
                },
              },
            },
          },
        );
        expect(compiledJSON?.contracts?.['test.sol']?.C).to.not.equals(
          undefined,
        );
        expect(compiledJSON?.contracts?.['test.sol']?.C?.evm?.bytecode?.object)
          .to.be.a('string')
          .and.not.equal('');
      } catch (e: any) {
        expect.fail(e.message);
      }
    });
  }

  it('Should return a compiler error', async function () {
    if (!findZkSolcPlatform() || !findEraSolcPlatform()) this.skip();

    try {
      await useZkSolcCompiler(
        zksolcRepoPath,
        eraSolcRepoPath,
        zksolcVersion,
        eraSolcVersion,
        {
          language: 'Solidity',
          sources: {
            'test.sol': {
              content: 'contract C { function f() public } }',
            },
          },
          settings: {
            outputSelection: {
              '*': {
                '*': ['abi', 'evm'],
              },
            },
          },
        },
      );
      expect.fail('Expected compiler error was not thrown');
    } catch (e: any) {
      expect(e.message.startsWith('Compiler error')).to.be.true;
      expect(e.errors?.some((error: any) => error.severity === 'error')).to.be
        .true;
      expect(e.errors?.some((error: any) => error.type === 'ParserError')).to.be
        .true;
    }
  });
});

describe('getZkSolcStandardJsonArgs', () => {
  const eraSolcPath = '/tmp/era-solc';
  const allowedPath = '/tmp/allowed';

  function makeJsonInput(settings: Record<string, unknown>): SolidityJsonInput {
    return {
      language: 'Solidity',
      sources: {},
      settings,
    } as unknown as SolidityJsonInput;
  }

  it('always includes --standard-json, --solc and --allow-paths', () => {
    const args = getZkSolcStandardJsonArgs(
      '1.5.7',
      eraSolcPath,
      allowedPath,
      makeJsonInput({}),
    );
    expect(args.slice(0, 3)).to.deep.equal([
      '--standard-json',
      '--solc',
      eraSolcPath,
    ]);
    expect(args.slice(-2)).to.deep.equal(['--allow-paths', allowedPath]);
  });

  it('maps enableEraVMExtensions / isSystem to --system-mode for pre-1.5 zksolc', () => {
    for (const flag of ['enableEraVMExtensions', 'isSystem']) {
      const args = getZkSolcStandardJsonArgs(
        '1.4.1',
        eraSolcPath,
        allowedPath,
        makeJsonInput({ [flag]: true }),
      );
      expect(args, flag).to.include('--system-mode');
      expect(args, flag).to.not.include('--force-evmla');
    }
  });

  it('maps forceEVMLA / forceEvmla to --force-evmla for pre-1.5 zksolc', () => {
    for (const flag of ['forceEVMLA', 'forceEvmla']) {
      const args = getZkSolcStandardJsonArgs(
        '1.4.1',
        eraSolcPath,
        allowedPath,
        makeJsonInput({ [flag]: true }),
      );
      expect(args, flag).to.include('--force-evmla');
      expect(args, flag).to.not.include('--system-mode');
    }
  });

  it('adds no mode flags for pre-1.5 zksolc when no zksolc settings are set', () => {
    const args = getZkSolcStandardJsonArgs(
      '1.4.1',
      eraSolcPath,
      allowedPath,
      makeJsonInput({ optimizer: { enabled: true } }),
    );
    expect(args).to.not.include('--system-mode');
    expect(args).to.not.include('--force-evmla');
  });

  it('does not add CLI mode flags for zksolc >= 1.5 even when settings are set', () => {
    const args = getZkSolcStandardJsonArgs(
      '1.5.7',
      eraSolcPath,
      allowedPath,
      makeJsonInput({
        enableEraVMExtensions: true,
        isSystem: true,
        forceEVMLA: true,
        forceEvmla: true,
      }),
    );
    expect(args).to.not.include('--system-mode');
    expect(args).to.not.include('--force-evmla');
  });

  it('treats vm-1.5.0-a167aa3 as pre-1.5 and maps its settings to CLI flags', () => {
    const args = getZkSolcStandardJsonArgs(
      'vm-1.5.0-a167aa3',
      eraSolcPath,
      allowedPath,
      makeJsonInput({ isSystem: true, forceEVMLA: true }),
    );
    expect(args).to.include('--system-mode');
    expect(args).to.include('--force-evmla');
  });
});

describe('isZkSolcVersionAtLeastV15 edge cases', () => {
  it('treats versions >= 1.5.0 as at least 1.5', () => {
    expect(isZkSolcVersionAtLeastV15('1.5.0')).to.equal(true);
    expect(isZkSolcVersionAtLeastV15('v2.0.0')).to.equal(true);
  });

  it('treats versions below 1.5.0, including 1.5.0 prereleases, as below 1.5', () => {
    expect(isZkSolcVersionAtLeastV15('1.4.9')).to.equal(false);
    // semver sorts prereleases below the corresponding release
    expect(isZkSolcVersionAtLeastV15('1.5.0-rc.1')).to.equal(false);
  });

  it('fails open: unparseable versions are treated as at least 1.5', () => {
    // Documents current behavior — see the guard in zksolcCompiler.ts.
    expect(isZkSolcVersionAtLeastV15('not-a-version')).to.equal(true);
  });
});

describe('getZkSolcExecutable download fallback', () => {
  let originalFetch: typeof commonModule.fetchWithBackoff;

  function fakeExecutableBuffer(): ArrayBuffer {
    return new TextEncoder().encode('#!/bin/sh\nprintf "zksolc test\\n"\n')
      .buffer as ArrayBuffer;
  }

  // Replaces fetchWithBackoff with a stub that responds based on the URL,
  // and records every requested URL.
  function stubFetch(
    handler: (url: string) => { status: number; body?: ArrayBuffer },
  ): string[] {
    const calls: string[] = [];
    (commonModule as { fetchWithBackoff: unknown }).fetchWithBackoff = async (
      url: string,
    ) => {
      calls.push(url);
      const { status, body } = handler(url);
      return { status, arrayBuffer: async () => body ?? new ArrayBuffer(0) };
    };
    return calls;
  }

  beforeEach(() => {
    originalFetch = commonModule.fetchWithBackoff;
  });

  afterEach(() => {
    (commonModule as { fetchWithBackoff: unknown }).fetchWithBackoff =
      originalFetch;
  });

  it('resolves from the primary repo without hitting the legacy repo', async function () {
    if (process.platform === 'win32') this.skip();
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'zksolc-dl-'));
    const calls = stubFetch(() => ({
      status: 200,
      body: fakeExecutableBuffer(),
    }));

    try {
      const resolved = await getZkSolcExecutable(
        repoPath,
        'macosx-arm64',
        '1.4.0',
      );
      expect(resolved).to.equal(
        path.join(repoPath, 'zksolc-macosx-arm64-v1.4.0'),
      );
      expect(calls).to.have.length(1);
      expect(calls[0]).to.include('/era-compiler-solidity/releases/download/');
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  });

  it('falls back to the legacy zksolc-bin repo when the primary repo 404s', async function () {
    if (process.platform === 'win32') this.skip();
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'zksolc-dl-'));
    const calls = stubFetch((url) =>
      url.includes('zksolc-bin')
        ? { status: 200, body: fakeExecutableBuffer() }
        : { status: 404 },
    );

    try {
      const resolved = await getZkSolcExecutable(
        repoPath,
        'macosx-arm64',
        '1.4.0',
      );
      expect(resolved).to.equal(
        path.join(repoPath, 'zksolc-macosx-arm64-v1.4.0'),
      );
      expect(calls).to.have.length(2);
      // Primary repo strips the leading v from the release tag...
      expect(calls[0]).to.include(
        '/era-compiler-solidity/releases/download/1.4.0/',
      );
      // ...while the legacy repo keeps it.
      expect(calls[1]).to.include('/zksolc-bin/releases/download/v1.4.0/');
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  });

  it('throws when neither the primary nor the legacy repo has the binary', async function () {
    if (process.platform === 'win32') this.skip();
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'zksolc-dl-'));
    const calls = stubFetch(() => ({ status: 404 }));

    try {
      await getZkSolcExecutable(repoPath, 'macosx-arm64', '1.4.0');
      expect.fail('Expected getZkSolcExecutable to throw');
    } catch (error) {
      expect((error as Error).message).to.match(/zksolc not found/);
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
    expect(calls).to.have.length(2);
  });
});

describe('getZkSolcBaseSolcExecutable routing', () => {
  it('routes an exact era-solc version to the era-solc repo', async function () {
    if (process.platform === 'win32') this.skip();
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'era-solc-route-'));
    const compilerPath = writeFakeCompilerBinary(
      repoPath,
      'solc-linux-amd64-0.8.26-1.0.1',
    );

    try {
      expect(
        await getZkSolcBaseSolcExecutable(
          repoPath,
          'linux-amd64',
          '0.8.26-1.0.1',
        ),
      ).to.equal(compilerPath);
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  });

  it('falls back to era-solc for a plain release version when no upstream solc repo is given', async function () {
    if (process.platform === 'win32') this.skip();
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'era-solc-route-'));
    const compilerPath = writeFakeCompilerBinary(
      repoPath,
      'solc-linux-amd64-0.8.26',
    );

    try {
      expect(
        await getZkSolcBaseSolcExecutable(repoPath, 'linux-amd64', '0.8.26'),
      ).to.equal(compilerPath);
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  });
});

describe('getZkSolcBaseSolcExecutable upstream solc', () => {
  let originalGetSolcExecutable: typeof solidityCompilerModule.getSolcExecutable;

  beforeEach(() => {
    originalGetSolcExecutable = solidityCompilerModule.getSolcExecutable;
  });

  afterEach(() => {
    (
      solidityCompilerModule as { getSolcExecutable: unknown }
    ).getSolcExecutable = originalGetSolcExecutable;
  });

  it('routes a commit-bearing solc release to the upstream solc resolver', async () => {
    const requestedVersions: string[] = [];
    (
      solidityCompilerModule as { getSolcExecutable: unknown }
    ).getSolcExecutable = async (
      _repo: string,
      _platform: string,
      version: string,
    ) => {
      requestedVersions.push(version);
      return '/fake/solc-bin/solc';
    };

    const resolved = await getZkSolcBaseSolcExecutable(
      '/era-solc-repo',
      'linux-amd64',
      'v0.8.26+commit.8a97fa7a',
      '/solc-repo',
      '/soljson-repo',
    );

    expect(resolved).to.equal('/fake/solc-bin/solc');
    // The leading v is stripped before resolving the upstream solc binary.
    expect(requestedVersions).to.deep.equal(['0.8.26+commit.8a97fa7a']);
  });

  it('throws when no upstream solc binary can be resolved', async () => {
    (
      solidityCompilerModule as { getSolcExecutable: unknown }
    ).getSolcExecutable = async () => {
      throw new Error('not found');
    };

    try {
      await getZkSolcBaseSolcExecutable(
        '/era-solc-repo',
        'linux-amd64',
        'v0.8.26+commit.8a97fa7a',
        '/solc-repo',
        '/soljson-repo',
      );
      expect.fail('Expected getZkSolcBaseSolcExecutable to throw');
    } catch (error) {
      expect((error as Error).message).to.match(
        /Unsupported upstream solc platform/,
      );
    }
  });
});
