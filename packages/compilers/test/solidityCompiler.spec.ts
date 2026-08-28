import { expect } from 'chai';
import {
  findSolcPlatform,
  getSolcExecutable,
  getSolcJs,
  useSolidityCompiler,
} from '../src/lib/solidityCompiler';
import { COMPILER_TIMEOUT_CODE } from '@ethereum-sourcify/compilers-types';
import earlyCompilerInput from './utils/pre-v0.4.0-input.json';
import { keccak256 } from 'ethers';
import path from 'path';
import fs from 'fs';

describe('Verify Solidity Compiler', () => {
  const compilersPath = path.join('/tmp', 'compilers-solc-repo');
  const solJsonRepo = path.join('/tmp', 'compilers-soljson-repo');

  it('Should fetch latest SolcJS compiler', async () => {
    expect(await getSolcJs(solJsonRepo, 'latest')).not.equals(null);
  });
  it('Should fetch SolcJS compiler passing only version', async () => {
    expect(await getSolcJs(solJsonRepo, '0.8.17+commit.8df45f5f')).not.equals(
      false,
    );
  });
  it('Should fetch SolcJS compiler that is saved as a link in the repo', async () => {
    expect(await getSolcJs(solJsonRepo, 'v0.5.14+commit.1f1aaa4')).not.equals(
      false,
    );
  });
  it('Should throw an error if the compiler is not found', async () => {
    try {
      await getSolcExecutable(compilersPath, 'linux-amd64', 'invalid-version');
      expect.fail('Expected error was not thrown');
    } catch (error) {
      expect(error).to.be.instanceOf(Error);
    }
  });
  if (process.platform === 'linux') {
    it('Should fetch latest solc from github', async () => {
      expect(
        await getSolcExecutable(
          compilersPath,
          'linux-amd64',
          '0.8.9+commit.e5eed63a',
        ),
      ).not.equals(null);
    });
    it('Should compile with solc', async () => {
      try {
        const compiledJSON = await useSolidityCompiler(
          compilersPath,
          solJsonRepo,
          '0.8.9+commit.e5eed63a',
          {
            language: 'Solidity',
            sources: {
              'test.sol': {
                content: 'contract C { function f() public  {} }',
              },
            },
            settings: {
              outputSelection: {
                '*': {
                  '*': ['*'],
                },
              },
            },
          },
        );
        expect(compiledJSON?.contracts?.['test.sol']?.C).to.not.equals(
          undefined,
        );
      } catch (e: any) {
        expect.fail(e.message);
      }
    });
  }
  it('Should return a compiler error', async () => {
    try {
      await useSolidityCompiler(
        compilersPath,
        solJsonRepo,
        '0.8.9+commit.e5eed63a',
        {
          language: 'Solidity',
          sources: {
            'test.sol': {
              content: 'contract C { function f() public  } }',
            },
          },
          settings: {
            outputSelection: {
              '*': {
                '*': ['*'],
              },
            },
          },
        },
      );
    } catch (e: any) {
      expect(e.message.startsWith('Compiler error')).to.be.true;
      expect(e.errors).to.deep.equal([
        {
          component: 'general',
          errorCode: '2314',
          formattedMessage:
            "ParserError: Expected '{' but got '}'\n --> test.sol:1:35:\n  |\n1 | contract C { function f() public  } }\n  |                                   ^\n\n",
          message: "Expected '{' but got '}'",
          severity: 'error',
          sourceLocation: {
            end: 35,
            file: 'test.sol',
            start: 34,
          },
          type: 'ParserError',
        },
      ]);
    }
  });
  it('Should compile with solcjs', async () => {
    const realPlatform = process.platform;
    Object.defineProperty(process, 'platform', {
      value: 'not existing platform',
      writable: false,
    });
    try {
      const compiledJSON = await useSolidityCompiler(
        compilersPath,
        solJsonRepo,
        '0.8.9+commit.e5eed63a',
        {
          language: 'Solidity',
          sources: {
            'test.sol': {
              content: 'contract C { function f() public  {} }',
            },
          },
          settings: {
            outputSelection: {
              '*': {
                '*': ['*'],
              },
            },
          },
        },
      );
      expect(compiledJSON?.contracts?.['test.sol']?.C).to.not.equals(undefined);
    } catch (e: any) {
      expect.fail(e.message);
    } finally {
      Object.defineProperty(process, 'platform', {
        value: realPlatform,
        writable: false,
      });
    }
  });

  // The soljson path runs in-process in a worker thread, so the timeout has to
  // terminate the thread instead of killing a subprocess. See #2880.
  it('Should time out a solcjs compilation that exceeds the timeout', async () => {
    let thrown: any;
    try {
      await useSolidityCompiler(
        compilersPath,
        solJsonRepo,
        '0.8.9+commit.e5eed63a',
        {
          language: 'Solidity',
          sources: {
            'test.sol': {
              content: 'contract C { function f() public  {} }',
            },
          },
          settings: {
            outputSelection: {
              '*': {
                '*': ['*'],
              },
            },
          },
        },
        true, // forceEmscripten, i.e. the soljson worker path
        1, // the worker cannot even load the compiler within 1ms
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown, 'expected the compilation to reject').to.be.instanceOf(
      Error,
    );
    expect(thrown.code).to.equal(COMPILER_TIMEOUT_CODE);
  });

  // See https://github.com/argotorg/sourcify/issues/1099
  it(`Should should use a clean compiler context with pre 0.4.0 versions`, async () => {
    // Run compiler once to change compiler "context"
    await useSolidityCompiler(
      compilersPath,
      solJsonRepo,
      '0.1.5+commit.23865e3',
      earlyCompilerInput,
    );

    // A second run needs to produce the same result
    const compilerResult = await useSolidityCompiler(
      compilersPath,
      solJsonRepo,
      '0.1.5+commit.23865e3',
      earlyCompilerInput,
    );
    const compiledBytecode = compilerResult?.contracts['']?.GroveLib?.evm
      ?.deployedBytecode?.object as string;
    const compiledHash = keccak256('0x' + compiledBytecode);
    expect(compiledHash).equals(
      '0xc778f3d42ce4a7ee21a2e93d45265cf771e5970e0e36f882310f4491d0ca889d',
    );
  });

  /**
   * Native solc --standard-json resolves missing imports against cwd (allowed
   * dirs: "."). From solc 0.8.8 onward this can read host files and leak their
   * contents through ParserError.formattedMessage (returned via compiler_error).
   * solc <=0.8.7 rejects the same imports as outside allowed directories.
   */
  it('Should not leak host cwd files through native solc import errors', async function () {
    // Force the native binary path used in production (linux-amd64 / macosx-amd64).
    // On darwin-arm64 findSolcPlatform() is false; temporarily report x64 so the
    // universal macos binary is selected (same as production's native path).
    const realArch = process.arch;
    const realPlatform = process.platform;
    if (realPlatform === 'darwin' && realArch === 'arm64') {
      Object.defineProperty(process, 'arch', {
        value: 'x64',
        configurable: true,
        writable: true,
      });
    }
    if (!findSolcPlatform()) {
      Object.defineProperty(process, 'arch', {
        value: realArch,
        configurable: true,
        writable: true,
      });
      this.skip();
    }

    const secretMarker = `LEAK_SECRET_VALUE_${process.pid}_${Date.now()}`;
    const secretFileName = `.sourcify-solc-cwd-leak-test-${process.pid}`;
    const secretFilePath = path.join(process.cwd(), secretFileName);
    fs.writeFileSync(secretFilePath, `${secretMarker}=super-secret\n`, 'utf8');

    try {
      try {
        await useSolidityCompiler(
          compilersPath,
          solJsonRepo,
          '0.8.28+commit.7893614a',
          {
            language: 'Solidity',
            sources: {
              'Contract.sol': {
                content: `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\nimport "./${secretFileName}";\ncontract C {}\n`,
              },
            },
            settings: {
              outputSelection: {
                '*': {
                  '*': ['evm.bytecode'],
                },
              },
            },
          },
        );
        expect.fail('Expected compilation to fail for non-Solidity import');
      } catch (e: any) {
        const serialized = `${e?.message || ''}\n${JSON.stringify(e?.errors || [])}`;
        expect(
          serialized.includes(secretMarker),
          `Compiler error leaked host file contents: ${serialized}`,
        ).to.equal(false);
        // Still a normal missing-import / parse failure, not a crash.
        expect(e.message.startsWith('Compiler error')).to.equal(true);
      }
    } finally {
      fs.rmSync(secretFilePath, { force: true });
      Object.defineProperty(process, 'arch', {
        value: realArch,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(process, 'platform', {
        value: realPlatform,
        configurable: true,
        writable: true,
      });
    }
  });
});
