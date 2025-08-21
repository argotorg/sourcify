import { expect } from 'chai';
import { useVyperCompiler } from '../src/lib/vyperCompiler';
import path from 'path';

describe('Verify Vyper Compiler', () => {
  const vyperRepoPath = path.join('/tmp', 'vyper-repo');

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
});
