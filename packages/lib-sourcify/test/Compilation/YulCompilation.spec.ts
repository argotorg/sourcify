import { describe, it } from 'mocha';
import { expect, use } from 'chai';
import fs from 'fs';
import path from 'path';
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
  it('should compile a Yul contract', async () => {
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

  // solc <0.6.9 does not output evm.deployedBytecode for Yul contracts.
  // See https://github.com/argotorg/sourcify/issues/2887
  it('should throw when the compiler does not output deployedBytecode', async () => {
    const jsonInputPath = path.join(
      __dirname,
      '..',
      'sources',
      'Yul',
      'deterministic-deployment-proxy',
      'jsonInput.json',
    );
    const jsonInput: SolidityJsonInput = JSON.parse(
      fs.readFileSync(jsonInputPath, 'utf8'),
    );

    const compilation = new YulCompilation(
      solc,
      '0.5.8+commit.23d335f2',
      jsonInput,
      {
        name: 'Proxy',
        path: 'deterministic-deployment-proxy.yul',
      },
    );

    await expect(compilation.compile(true))
      .to.eventually.be.rejectedWith(
        'The compiler did not output the runtime bytecode',
      )
      .and.have.property(
        'code',
        'runtime_bytecode_not_found_in_compiler_output',
      );
  });
});
