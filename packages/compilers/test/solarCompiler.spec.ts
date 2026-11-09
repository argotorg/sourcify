import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { parseSolarVersion } from '@ethereum-sourcify/compilers-types';
import type { SolarJsonInput } from '@ethereum-sourcify/compilers-types';
import {
  findSolarPlatform,
  getSolarExecutable,
  useSolarCompiler,
} from '../src/lib/solarCompiler';
import { useSolidityCompiler } from '../src/lib/solidityCompiler';
import { CompilerError } from '../src/lib/common';

const SOLAR_TEST_VERSION = '0.8.38+commit.e7a91fc7.solar.0.3.0';
// The Solar that Foundry v1.9.0 bundles, hosted by Sourcify for Linux x64
const FOUNDRY_SOLAR_VERSION = '0.8.38+commit.a2b44354.solar.0.3.0-dev';
const HOSTED_PLATFORM = 'x86_64-unknown-linux-musl';

const solarRepoPath = path.join('/tmp', 'compilers-solar-repo');

const factoryInput: SolarJsonInput = {
  language: 'Solidity',
  sources: {
    'A.sol': {
      content:
        '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract Child { uint256 public x; constructor(uint256 _x) { x = _x; } }\ncontract Factory {\n  uint256 public immutable seed;\n  constructor(uint256 _seed) { seed = _seed; }\n  function make() external returns (address) { return address(new Child(seed)); }\n}\n',
    },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      'A.sol': {
        Factory: [
          'metadata',
          'evm.bytecode.object',
          'evm.bytecode.cborAuxdata',
          'evm.deployedBytecode.cborAuxdata',
        ],
      },
    },
  },
};

describe('Solar version parsing', () => {
  it('Should parse a release version', () => {
    expect(
      parseSolarVersion('0.8.38+commit.e7a91fc7.solar.0.3.0'),
    ).to.deep.equal({
      solcVersion: '0.8.38',
      commit: 'e7a91fc7',
      solarVersion: '0.3.0',
    });
  });

  it('Should parse a dev build version with a v prefix', () => {
    expect(
      parseSolarVersion('v0.8.38+commit.b079122f.solar.0.2.0-dev'),
    ).to.deep.equal({
      solcVersion: '0.8.38',
      commit: 'b079122f',
      solarVersion: '0.2.0-dev',
    });
  });

  it('Should not parse solc versions or the old 7-digit Solar format', () => {
    expect(parseSolarVersion('0.8.36+commit.8a079791')).to.be.undefined;
    expect(parseSolarVersion('0.8.36+commit.d83529b.solar.0.2.0')).to.be
      .undefined;
    expect(parseSolarVersion('0.2.0')).to.be.undefined;
  });
});

describe('Verify Solar Compiler', () => {
  it('Should detect the Solar platform', () => {
    expect(findSolarPlatform()).to.be.a('string');
  });

  it('Should not download a build that is not a release and that Sourcify does not host', async () => {
    const platform = findSolarPlatform() as string;
    try {
      await getSolarExecutable(
        solarRepoPath,
        platform,
        parseSolarVersion('0.8.38+commit.00000000.solar.0.3.0-dev')!,
      );
      expect.fail('Expected error was not thrown');
    } catch (error: any) {
      expect(error.message).to.contain('is not a release');
    }
  });

  it('Should download a release and cache it', async () => {
    const platform = findSolarPlatform() as string;
    const version = parseSolarVersion(SOLAR_TEST_VERSION)!;
    const cachedPath = path.join(
      solarRepoPath,
      `solar-${platform}-v${version.solarVersion}+commit.${version.commit}`,
    );
    fs.rmSync(cachedPath, { force: true });
    const solarPath = await getSolarExecutable(
      solarRepoPath,
      platform,
      version,
    );
    expect(solarPath).to.equal(cachedPath);
    expect(fs.existsSync(solarPath)).to.be.true;
  });

  it('Should replace a cached release binary that reports another build', async () => {
    const platform = findSolarPlatform() as string;
    const version = parseSolarVersion(SOLAR_TEST_VERSION)!;
    const cachedPath = path.join(
      solarRepoPath,
      `solar-${platform}-v${version.solarVersion}+commit.${version.commit}`,
    );
    // E.g. a crates.io build copied by hand under the release file name
    fs.mkdirSync(solarRepoPath, { recursive: true });
    fs.writeFileSync(
      cachedPath,
      '#!/bin/sh\necho "solar 0.3.0+commit.275d15ec"\n',
      { mode: 0o755 },
    );
    const solarPath = await getSolarExecutable(
      solarRepoPath,
      platform,
      version,
    );
    expect(solarPath).to.equal(cachedPath);
    const firstLine = spawnSync(solarPath, ['--version'])
      .stdout.toString()
      .split('\n')[0]
      .trim();
    expect(firstLine).to.equal(
      `solar ${version.solarVersion}+commit.${version.commit}`,
    );
  });

  it('Should download the copy that Sourcify hosts of a build that is not a release', async function () {
    if (findSolarPlatform() !== HOSTED_PLATFORM) {
      this.skip();
    }
    const version = parseSolarVersion(FOUNDRY_SOLAR_VERSION)!;
    const cachedPath = path.join(
      solarRepoPath,
      `solar-${HOSTED_PLATFORM}-v${version.solarVersion}+commit.${version.commit}`,
    );
    fs.rmSync(cachedPath, { force: true });
    const solarPath = await getSolarExecutable(
      solarRepoPath,
      HOSTED_PLATFORM,
      version,
    );
    expect(solarPath).to.equal(cachedPath);
    expect(fs.existsSync(solarPath)).to.be.true;
  });

  it('Should replace a cached build that is not a release and reports another build', async function () {
    if (findSolarPlatform() !== HOSTED_PLATFORM) {
      this.skip();
    }
    const version = parseSolarVersion(FOUNDRY_SOLAR_VERSION)!;
    const cachedPath = path.join(
      solarRepoPath,
      `solar-${HOSTED_PLATFORM}-v${version.solarVersion}+commit.${version.commit}`,
    );
    fs.mkdirSync(solarRepoPath, { recursive: true });
    fs.writeFileSync(
      cachedPath,
      '#!/bin/sh\necho "solar 0.3.0-dev+commit.11111111"\n',
      { mode: 0o755 },
    );
    const solarPath = await getSolarExecutable(
      solarRepoPath,
      HOSTED_PLATFORM,
      version,
    );
    const firstLine = spawnSync(solarPath, ['--version'])
      .stdout.toString()
      .split('\n')[0]
      .trim();
    expect(firstLine).to.equal('solar 0.3.0-dev+commit.a2b44354');
  });

  it('Should reject a release binary with a different commit', async () => {
    const platform = findSolarPlatform() as string;
    // v0.2.0 is a real release, but not of this commit
    const version = parseSolarVersion('0.8.35+commit.00000000.solar.0.2.0')!;
    try {
      await getSolarExecutable(solarRepoPath, platform, version);
      expect.fail('Expected error was not thrown');
    } catch (error: any) {
      expect(error.message).to.contain('not found');
    }
    // The rejected download must not stay in the cache
    const cached = fs
      .readdirSync(solarRepoPath)
      .filter((file) => file.includes('commit.00000000'));
    expect(cached).to.deep.equal([]);
  });

  it('Should compile and report the CBOR auxdata positions', async () => {
    const output = await useSolarCompiler(
      solarRepoPath,
      SOLAR_TEST_VERSION,
      factoryInput,
    );
    const factory = output.contracts['A.sol'].Factory;
    const metadata = JSON.parse(factory.metadata!);
    expect(metadata.compiler).to.deep.equal({
      name: 'solar',
      version: SOLAR_TEST_VERSION,
    });
    // The factory embeds the child, so its bytecode has two trailers
    expect(factory.evm.bytecode.cborAuxdata).to.have.keys([
      'A.sol:Child',
      'A.sol:Factory',
    ]);
    expect(factory.evm.deployedBytecode.cborAuxdata).to.have.keys([
      'A.sol:Child',
      'A.sol:Factory',
    ]);
  });

  it('Should throw a CompilerError for invalid source code', async () => {
    try {
      await useSolarCompiler(solarRepoPath, SOLAR_TEST_VERSION, {
        language: 'Solidity',
        sources: { 'A.sol': { content: 'contract A { function }' } },
        settings: { outputSelection: { '*': { '*': ['evm.bytecode'] } } },
      });
      expect.fail('Expected error was not thrown');
    } catch (error) {
      expect(error).to.be.instanceOf(CompilerError);
    }
  });

  it('Should reject an invalid Solar version', async () => {
    try {
      await useSolarCompiler(solarRepoPath, '0.8.38', factoryInput);
      expect.fail('Expected error was not thrown');
    } catch (error: any) {
      expect(error.message).to.contain('Invalid Solar version');
    }
  });

  it('Should not compile a Solar version with solc', async () => {
    try {
      await useSolidityCompiler(
        '/tmp/compilers-solc-repo',
        '/tmp/compilers-soljson-repo',
        SOLAR_TEST_VERSION,
        factoryInput,
      );
      expect.fail('Expected error was not thrown');
    } catch (error: any) {
      expect(error.message).to.contain('is a Solar version');
    }
  });
});
