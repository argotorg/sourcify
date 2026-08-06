import { expect } from 'chai';
import path from 'path';
import { resolveCompilerArtifactPath } from '../src/lib/common';
import { getSolcExecutable } from '../src/lib/solidityCompiler';

describe('resolveCompilerArtifactPath', () => {
  const repo = path.join('/tmp', 'compilers-artifact-repo');

  it('accepts normal solc version file names', () => {
    const version = '0.8.28+commit.7893614a';
    const fileName = `solc-linux-amd64-v${version}`;
    const resolved = resolveCompilerArtifactPath(repo, fileName, version);
    expect(resolved).to.equal(path.resolve(repo, fileName));
  });

  it('rejects versions containing path separators', () => {
    const version = '0.8.28/../../../tmp/pwn';
    const fileName = `solc-linux-amd64-v${version}`;
    expect(() => resolveCompilerArtifactPath(repo, fileName, version)).to.throw(
      /Invalid compiler version/,
    );
  });

  it('rejects versions containing ..', () => {
    expect(() =>
      resolveCompilerArtifactPath(
        repo,
        'solc-linux-amd64-v0.8.28..x',
        '0.8.28..x',
      ),
    ).to.throw(/Invalid compiler version/);
  });

  it('rejects backslash separators in version', () => {
    const version = '0.8.28\\..\\..\\pwn';
    const fileName = `solc-linux-amd64-v${version}`;
    expect(() => resolveCompilerArtifactPath(repo, fileName, version)).to.throw(
      /Invalid compiler version/,
    );
  });
});

describe('getSolcExecutable path safety', () => {
  const compilersPath = path.join('/tmp', 'compilers-solc-repo-path-safety');

  it('does not fetch or write when version escapes the repo', async () => {
    try {
      await getSolcExecutable(
        compilersPath,
        'linux-amd64',
        '0.8.28/../../../tmp/pwn',
      );
      expect.fail('Expected invalid version to be rejected');
    } catch (e: any) {
      expect(e.message).to.match(/Invalid compiler version/);
    }
  });
});
