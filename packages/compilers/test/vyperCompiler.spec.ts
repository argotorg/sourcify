import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import {
  findVyperPlatform,
  getVyperExecutable,
  stringifyVyperJsonInput,
  useVyperCompiler,
} from '../src/lib/vyperCompiler';
import { isValidVyperVersion } from '@ethereum-sourcify/compilers-types';
import path from 'path';

describe('Verify Vyper Compiler', () => {
  const vyperRepoPath = path.join('/tmp', 'compilers-vyper-repo');

  it('Should escape non-ASCII characters in standard-json stdin', function () {
    const vyperJsonInput = {
      language: 'Vyper' as const,
      sources: {
        'test.vy': {
          content: '# ∫(rate * balance / totalSupply dt)\n',
        },
      },
      settings: {
        outputSelection: {
          '*': ['*'],
        },
      },
    };

    const inputStringified = stringifyVyperJsonInput(vyperJsonInput);

    expect(inputStringified).to.include('\\u222b');
    expect(inputStringified).to.not.include('∫');
    expect(JSON.parse(inputStringified)).to.deep.equal(vyperJsonInput);
  });

  it('Should compile with vyper', async function () {
    const compiledJSON = await useVyperCompiler(
      vyperRepoPath,
      '0.3.7+commit.6020b8bb',
      {
        language: 'Vyper',
        sources: {
          'test.vy': {
            content: '@external\ndef test() -> uint256:\n    return 42',
          },
        },
        settings: {
          outputSelection: {
            '*': ['*'],
          },
        },
      },
    );
    expect(compiledJSON?.contracts?.['test.vy']?.test).to.not.equal(undefined);
  });

  it('Should handle vyper 0.3.10 warnings', async function () {
    const compiledJSON = await useVyperCompiler(
      vyperRepoPath,
      '0.3.10+commit.91361694',
      {
        language: 'Vyper',
        sources: {
          'test.vy': {
            content: `@external
@view
def foo(x: uint256, y: int128) -> uint256:
    return shift(x, y)`,
          },
        },
        settings: {
          outputSelection: {
            '*': ['*'],
          },
        },
      },
    );
    expect(compiledJSON?.contracts?.['test.vy']?.test).to.not.equal(undefined);
    // 0.3.10 doesn't include the warnings in the standardJson output
    expect(compiledJSON?.errors).to.be.undefined;
  });

  it('Should handle vyper 0.3.10 warnings and errors', async function () {
    try {
      const compiledJSON = await useVyperCompiler(
        vyperRepoPath,
        '0.3.10+commit.91361694',
        {
          language: 'Vyper',
          sources: {
            'test.vy': {
              content: `@exernal
@view
def foo(x: uint256, y: int128) -> uint256:
    return shift(x, y)`,
            },
          },
          settings: {
            outputSelection: {
              '*': ['*'],
            },
          },
        },
      );
      expect(compiledJSON?.contracts?.['test.vy']?.test).to.not.equal(
        undefined,
      );
    } catch (error: any) {
      // 0.3.10 doesn't include the warnings in the standardJson output but in the errors
      expect(error.errors?.some((e: any) => e.severity === 'warning')).to.be
        .false;
      expect(error.errors?.some((e: any) => e.severity === 'error')).to.be.true;
    }
  });

  it('Should handle vyper 0.4.0 warnings', async function () {
    const compiledJSON = await useVyperCompiler(
      vyperRepoPath,
      '0.4.0+commit.e9db8d9f',
      {
        language: 'Vyper',
        sources: {
          'test.vy': {
            content: `@external
@view
def foo(x: uint256, y: int128) -> uint256:
    return shift(x, y)`,
          },
        },
        settings: {
          outputSelection: {
            '*': ['*'],
          },
        },
      },
    );
    expect(compiledJSON?.contracts?.['test.vy']?.test).to.not.equal(undefined);
    // Should still compile successfully despite warnings
    expect(compiledJSON?.errors?.some((e) => e.severity === 'warning')).to.be
      .true;
  });

  describe('Vyper version validation', () => {
    it('Should accept the Vyper versions used in the repository', () => {
      for (const version of [
        '0.3.7+commit.6020b8bb',
        '0.3.10+commit.91361694',
        '0.1.0b16+commit.5e4a94a',
        '0.1.0-beta.16+commit.5e4a94a',
        '0.2.0+commit.d2c0c87',
        '0.4.0rc3+commit.f2136550',
        '0.4.0rc4+commit.d0d581d',
        '0.4.1b1+commit.039d3692',
        '0.4.1b4+commit.4507d2a6',
        '0.4.1rc1',
      ]) {
        expect(isValidVyperVersion(version), version).to.equal(true);
      }
    });

    it('Should reject Vyper versions with path characters or a second +', () => {
      for (const version of [
        '0.3.10rc1+commit.91361694+/../../x/payload',
        '0.3.10/../../x',
        '0.3.10+commit.91361694+commit.91361694',
        '0.3.10+commit.91361694\n',
        '../0.3.10',
        '',
      ]) {
        expect(isValidVyperVersion(version), version).to.equal(false);
      }
    });

    it('Should reject invalid versions in getVyperExecutable', async () => {
      for (const version of [
        '0.3.10rc1+commit.91361694+/../../x/payload',
        '0.3.10/x',
        '0.3.10+commit.91361694+commit.91361694',
      ]) {
        let thrown: unknown;
        try {
          await getVyperExecutable(vyperRepoPath, 'linux', version);
        } catch (error) {
          thrown = error;
        }
        expect(thrown, version).to.be.instanceOf(Error);
        expect((thrown as Error).message).to.include('Invalid Vyper version');
      }
    });

    it('Should not run a file outside the Vyper repository', async function () {
      if (process.platform === 'win32') {
        this.skip();
      }
      const platform = findVyperPlatform() || 'linux';
      const baseDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'sourcify-vyper-path-'),
      );
      try {
        const repoPath = path.join(baseDir, 'repo');
        const payloadDir = path.join(baseDir, 'x');
        const markerPath = path.join(baseDir, 'marker');
        fs.mkdirSync(repoPath);
        fs.mkdirSync(payloadDir);
        // The old path logic resolves the version below to this script.
        fs.writeFileSync(
          path.join(payloadDir, `payload.${platform}`),
          `#!/bin/sh\ntouch "${markerPath}"\n`,
          { mode: 0o755 },
        );

        let thrown: unknown;
        try {
          await getVyperExecutable(
            repoPath,
            platform,
            '0.3.10rc1+commit.91361694+/../../x/payload',
          );
        } catch (error) {
          thrown = error;
        }
        expect(thrown).to.be.instanceOf(Error);
        expect(fs.existsSync(markerPath)).to.equal(false);
      } finally {
        fs.rmSync(baseDir, { recursive: true, force: true });
      }
    });
  });
});
