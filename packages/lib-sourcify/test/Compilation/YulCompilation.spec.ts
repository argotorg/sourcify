import { describe, it } from 'mocha';
import { expect, use } from 'chai';
import fs from 'fs';
import path from 'path';
import { id as keccak256str } from 'ethers';
import chaiAsPromised from 'chai-as-promised';
import { YulCompilation } from '../../src/Compilation/YulCompilation';
import { solc } from '../utils';
import type { SolidityJsonInput } from '@ethereum-sourcify/compilers-types';

use(chaiAsPromised);

const compilerVersion = '0.8.26+commit.8a97fa7a';
const contractName = 'cas-forwarder';
const contractPath = 'cas-forwarder.yul';
const fixturesBasePath = path.join(
  __dirname,
  '..',
  'sources',
  'Yul',
  'cas-forwarder',
);

function loadJsonInput(): SolidityJsonInput {
  const jsonInputPath = path.join(fixturesBasePath, 'jsonInput.json');
  return JSON.parse(fs.readFileSync(jsonInputPath, 'utf8'));
}

describe('YulCompilation', () => {
  it('should compile a Yul contract and generate metadata', async () => {
    const jsonInput = loadJsonInput();

    const compilation = new YulCompilation(solc, compilerVersion, jsonInput, {
      name: contractName,
      path: contractPath,
    });

    await compilation.compile(true);

    expect(compilation.creationBytecode).to.equal(
      '0x603780600a5f395ff3fe5f8080803560601c81813b9283923c818073ca11bde05977b3631167028862be2a173976ca115af13d90815f803e156034575ff35b5ffd',
    );
    expect(compilation.runtimeBytecode).to.equal(
      '0x5f8080803560601c81813b9283923c818073ca11bde05977b3631167028862be2a173976ca115af13d90815f803e156034575ff35b5ffd',
    );

    const metadata = compilation.metadata;
    expect(metadata.language).to.equal('Yul');
    expect(metadata.compiler.version).to.equal(compilerVersion);
    expect(metadata.settings.compilationTarget).to.deep.equal({
      [contractPath]: contractName,
    });

    const expectedSourceHash = keccak256str(
      jsonInput.sources[contractPath].content,
    );
    expect(metadata.sources[contractPath].keccak256).to.equal(
      expectedSourceHash,
    );
  });

  it('should throw when compilation target is invalid', async () => {
    const jsonInput = loadJsonInput();

    const compilation = new YulCompilation(solc, compilerVersion, jsonInput, {
      name: 'non-existent',
      path: 'wrong-path.yul',
    });

    await expect(compilation.compile(true)).to.be.rejectedWith(
      'Contract not found in compiler output.',
    );
  });
});
