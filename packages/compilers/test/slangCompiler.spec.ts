import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { parseSlangVersion } from '@ethereum-sourcify/compilers-types';
import type { SlangJsonInput } from '@ethereum-sourcify/compilers-types';
import {
  fetchAndSaveSlangAsset,
  findSlangPlatform,
  getSlangExecutable,
  useSlangCompiler,
} from '../src/lib/slangCompiler';
import { useSolidityCompiler } from '../src/lib/solidityCompiler';
import { CompilerError } from '../src/lib/common';

const SLANG_TEST_VERSION = '0.2.0+slang';
// No release has the standard asset name yet. This pre-release reports 0.2.0.
const SLANG_PRE_RELEASE_SUFFIX = '2026-10-29';

const slangRepoPath = path.join('/tmp', 'compilers-slang-repo');

const factoryInput: SlangJsonInput = {
  language: 'Solidity',
  sources: {
    'A.sol': {
      content:
        '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract Child { uint256 public x; constructor(uint256 _x) { x = _x; } }\ncontract Factory {\n  uint256 public immutable seed;\n  constructor(uint256 _seed) { seed = _seed; }\n  function make() external returns (address) { return address(new Child(seed)); }\n}\n',
    },
  },
  settings: {
    optimizer: { mode: '3' },
    solidityVersion: '0.8.28',
    evmVersion: 'cancun',
    outputSelection: {
      'A.sol': {
        Factory: [
          'metadata',
          'evm.bytecode.object',
          'evm.deployedBytecode.object',
        ],
      },
    },
  },
};

describe('Slang version parsing', () => {
  it('Should parse a release version', () => {
    expect(parseSlangVersion('0.2.0+slang')).to.deep.equal({
      slangVersion: '0.2.0',
    });
  });

  it('Should parse a pre-release version with a v prefix', () => {
    expect(parseSlangVersion('v0.2.0-pre.2026-11-12+slang')).to.deep.equal({
      slangVersion: '0.2.0-pre.2026-11-12',
    });
  });

  it('Should not parse solc or Solar versions', () => {
    expect(parseSlangVersion('0.2.0')).to.be.undefined;
    expect(parseSlangVersion('0.8.36+commit.8a079791')).to.be.undefined;
    expect(parseSlangVersion('0.8.38+commit.e7a91fc7.solar.0.3.0')).to.be
      .undefined;
  });
});

describe('Verify Slang Compiler', () => {
  const platform = findSlangPlatform() as string;
  const cachedPath = path.join(slangRepoPath, `slang-${platform}-v0.2.0`);

  it('Should detect the Slang platform', () => {
    expect(platform).to.be.a('string');
  });

  it('Should not download a version that is not a release', async () => {
    try {
      await getSlangExecutable(slangRepoPath, platform, '9.9.9');
      expect.fail('Expected error was not thrown');
    } catch (error: any) {
      expect(error.message).to.contain('Failed fetching');
    }
  });

  it('Should replace a cached binary that reports another version', async () => {
    fs.mkdirSync(slangRepoPath, { recursive: true });
    fs.writeFileSync(
      cachedPath,
      '#!/bin/sh\necho "slang v0.1.0, LLVM-based Solidity compiler for the EVM"\n',
      { mode: 0o755 },
    );
    try {
      await getSlangExecutable(slangRepoPath, platform, '0.2.0');
      expect.fail('Expected error was not thrown');
    } catch (error: any) {
      // The wrong binary is removed, and 0.2.0 has no asset to download yet
      expect(error.message).to.contain('Failed fetching');
    }
    expect(fs.existsSync(cachedPath)).to.be.false;
  });

  it('Should download an asset and check its SHA-256', async () => {
    fs.rmSync(cachedPath, { force: true });
    await fetchAndSaveSlangAsset(
      `slang-${platform}-${SLANG_PRE_RELEASE_SUFFIX}`,
      cachedPath,
    );
    expect(fs.existsSync(cachedPath)).to.be.true;
  });

  it('Should use the cached binary', async () => {
    const slangPath = await getSlangExecutable(
      slangRepoPath,
      platform,
      '0.2.0',
    );
    expect(slangPath).to.equal(cachedPath);
  });

  it('Should compile and name Slang in the metadata', async () => {
    const output = await useSlangCompiler(
      slangRepoPath,
      SLANG_TEST_VERSION,
      factoryInput,
    );
    const factory = output.contracts['A.sol'].Factory;
    const metadata = JSON.parse(factory.metadata!);
    expect(metadata.compiler).to.deep.equal({
      name: 'slang',
      version: '0.2.0',
    });
    expect(metadata.settings.solidityVersion).to.equal('0.8.28');
    expect(factory.evm.bytecode.object).to.not.be.empty;
    // The creation code ends with the runtime code
    expect(
      factory.evm.bytecode.object.endsWith(factory.evm.deployedBytecode.object),
    ).to.be.true;
  });

  it('Should throw a CompilerError for invalid source code', async () => {
    try {
      await useSlangCompiler(slangRepoPath, SLANG_TEST_VERSION, {
        language: 'Solidity',
        sources: { 'A.sol': { content: 'contract A { function }' } },
        settings: {
          outputSelection: { '*': { '*': ['evm.bytecode.object'] } },
        },
      });
      expect.fail('Expected error was not thrown');
    } catch (error) {
      expect(error).to.be.instanceOf(CompilerError);
    }
  });

  it('Should reject an invalid Slang version', async () => {
    try {
      await useSlangCompiler(slangRepoPath, '0.2.0', factoryInput);
      expect.fail('Expected error was not thrown');
    } catch (error: any) {
      expect(error.message).to.contain('Invalid Slang version');
    }
  });

  it('Should not compile a Slang version with solc', async () => {
    try {
      await useSolidityCompiler(
        '/tmp/compilers-solc-repo',
        '/tmp/compilers-soljson-repo',
        SLANG_TEST_VERSION,
        factoryInput,
      );
      expect.fail('Expected error was not thrown');
    } catch (error: any) {
      expect(error.message).to.contain('is a Slang version');
    }
  });
});
