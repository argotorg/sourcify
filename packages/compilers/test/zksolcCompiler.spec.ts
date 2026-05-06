import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  findEraSolcPlatform,
  findZkSolcPlatform,
  getEraSolcExecutable,
  getZkSolcExecutable,
  isZkSolcVersionAtLeast,
  normalizeEraSolcVersion,
  normalizeZkSolcVersion,
  useZkSolcCompiler,
} from '../src/lib/zksolcCompiler';

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
    expect(isZkSolcVersionAtLeast('v1.5.0', '1.5.0')).to.equal(true);
    expect(isZkSolcVersionAtLeast('1.4.1', '1.5.0')).to.equal(false);
    expect(isZkSolcVersionAtLeast('vm-1.5.0-a167aa3', '1.5.0')).to.equal(false);
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
