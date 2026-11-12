import { describe, it, before, after } from 'mocha';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import type { ChildProcess } from 'child_process';
import { AbiCoder, type JsonRpcSigner } from 'ethers';
import {
  startHardhatNetwork,
  stopHardhatNetwork,
} from '@ethereum-sourcify/test-helpers';
import { Verification } from '../../src/Verification/Verification';
import { SlangCompilation } from '../../src/Compilation/SlangCompilation';
import type { SlangJsonInput, SlangSettings } from '../../src';
import { SourcifyChain, SourcifyLibError } from '../../src';
import { deployFeContract, expectVerification, slangCompiler } from '../utils';

use(chaiAsPromised);

const SLANG_VERSION = '0.2.0+slang';

const HARDHAT_PORT = 8545;
const sourcifyChain = new SourcifyChain({
  name: 'Hardhat Network Localhost',
  shortName: 'Hardhat Network',
  chainId: 31337,
  faucets: [],
  infoURL: 'localhost',
  nativeCurrency: { name: 'localETH', symbol: 'localETH', decimals: 18 },
  network: 'testnet',
  networkId: 31337,
  rpcs: [{ rpc: `http://localhost:${HARDHAT_PORT}` }],
  supported: true,
});

const FACTORY_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Child {
    uint256 public x;

    constructor(uint256 _x) {
        x = _x;
    }
}

contract Factory {
    uint256 public immutable seed;
    address public immutable owner;

    constructor(uint256 _seed) {
        seed = _seed;
        owner = msg.sender;
    }

    function make() external returns (address) {
        return address(new Child(seed));
    }
}
`;

const LIBRARY_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library Counters {
    function increment(uint256 value) external pure returns (uint256) {
        return value + 1;
    }
}

contract Counter {
    uint256 public count;

    function increment() external {
        count = Counters.increment(count);
    }
}
`;

// A function that changes the state makes the library check its own address
const STATE_LIBRARY_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library Registry {
    function add(uint256[] storage values, uint256 value) external {
        values.push(value);
    }
}
`;

const factoryTarget = { path: 'Factory.sol', name: 'Factory' };

function jsonInput(
  sources: Record<string, string>,
  settings: SlangSettings = {},
): SlangJsonInput {
  return {
    language: 'Solidity',
    sources: Object.fromEntries(
      Object.entries(sources).map(([path, content]) => [path, { content }]),
    ),
    settings: {
      optimizer: { mode: '3' },
      evmVersion: 'cancun',
      solidityVersion: '0.8.28',
      ...settings,
    },
  };
}

describe('SlangVerification', () => {
  let hardhatNodeProcess: ChildProcess;
  let signer: JsonRpcSigner;

  before(async () => {
    hardhatNodeProcess = await startHardhatNetwork(HARDHAT_PORT);
    signer = await sourcifyChain.rpcs[0].provider!.getSigner();
  });

  after(async () => {
    await stopHardhatNetwork(hardhatNodeProcess);
  });

  // Compiles with Slang and deploys, with optional constructor arguments
  async function deploy(
    input: SlangJsonInput,
    target: { path: string; name: string },
    constructorArguments = '',
  ) {
    const compilation = new SlangCompilation(
      slangCompiler,
      SLANG_VERSION,
      input,
      target,
    );
    await compilation.compile();
    return await deployFeContract(
      signer,
      compilation.creationBytecode + constructorArguments,
    );
  }

  async function deployFactory(source: string, settings: SlangSettings = {}) {
    const args = AbiCoder.defaultAbiCoder().encode(['uint256'], [42]);
    return await deploy(
      jsonInput({ 'Factory.sol': source }, settings),
      factoryTarget,
      args.slice(2),
    );
  }

  async function verify(
    input: SlangJsonInput,
    target: { path: string; name: string },
    deployment: { contractAddress: string; txHash: string },
  ) {
    const compilation = new SlangCompilation(
      slangCompiler,
      SLANG_VERSION,
      input,
      target,
    );
    const verification = new Verification(
      compilation,
      sourcifyChain,
      deployment.contractAddress,
      deployment.txHash,
    );
    await verification.verify();
    return verification;
  }

  it('should fully match a factory with immutables and constructor arguments', async () => {
    const deployment = await deployFactory(FACTORY_SOURCE);
    const verification = await verify(
      jsonInput({ 'Factory.sol': FACTORY_SOURCE }),
      factoryTarget,
      deployment,
    );
    expectVerification(verification, {
      status: { runtimeMatch: 'perfect', creationMatch: 'perfect' },
    });
    // The factory embeds the child, so each bytecode has two trailers
    const compilation = verification.compilation;
    expect(Object.keys(compilation.runtimeBytecodeCborAuxdata)).to.deep.equal([
      '1',
      '2',
    ]);
    expect(Object.keys(compilation.creationBytecodeCborAuxdata)).to.deep.equal([
      '1',
      '2',
    ]);
    expect(compilation.runtimeBytecodeCborAuxdata['1'].offset).to.be.lessThan(
      compilation.runtimeBytecodeCborAuxdata['2'].offset,
    );
    expect(compilation.compilerVersion).to.equal(SLANG_VERSION);
  });

  it('should partially match when only a comment differs', async () => {
    const deployment = await deployFactory(FACTORY_SOURCE);
    const verification = await verify(
      jsonInput({ 'Factory.sol': FACTORY_SOURCE + '// a comment\n' }),
      factoryTarget,
      deployment,
    );
    expectVerification(verification, {
      status: { runtimeMatch: 'partial', creationMatch: 'partial' },
    });
  });

  it('should partially match a contract without a metadata hash', async () => {
    const settings = { metadata: { bytecodeHash: 'none' } };
    const deployment = await deployFactory(FACTORY_SOURCE, settings);
    const verification = await verify(
      jsonInput({ 'Factory.sol': FACTORY_SOURCE }, settings),
      factoryTarget,
      deployment,
    );
    expectVerification(verification, {
      status: { runtimeMatch: 'partial', creationMatch: 'partial' },
    });
  });

  it('should match a contract with a library linked after the compilation', async () => {
    const target = { path: 'Counter.sol', name: 'Counter' };
    const library = await deploy(jsonInput({ 'Counter.sol': LIBRARY_SOURCE }), {
      path: 'Counter.sol',
      name: 'Counters',
    });
    const deployment = await deploy(
      jsonInput(
        { 'Counter.sol': LIBRARY_SOURCE },
        {
          libraries: {
            'Counter.sol': { Counters: library.contractAddress },
          },
        },
      ),
      target,
    );
    // Without the library address, the compiled bytecode has a placeholder
    const verification = await verify(
      jsonInput({ 'Counter.sol': LIBRARY_SOURCE }),
      target,
      deployment,
    );
    expectVerification(verification, {
      status: { runtimeMatch: 'partial', creationMatch: 'partial' },
    });
    expect(verification.transformations.runtime.values.libraries).to.deep.equal(
      {
        'Counter.sol:Counters': library.contractAddress.toLowerCase(),
      },
    );
  });

  it('should fully match a library that stores its own address', async () => {
    const target = { path: 'Registry.sol', name: 'Registry' };
    const input = jsonInput({ 'Registry.sol': STATE_LIBRARY_SOURCE });
    const deployment = await deploy(input, target);
    const verification = await verify(input, target, deployment);
    expectVerification(verification, {
      status: { runtimeMatch: 'perfect', creationMatch: 'perfect' },
    });
    // Slang reports the address for the call protection as an immutable
    expect(
      verification.transformations.runtime.values.immutables,
    ).to.deep.equal({
      library_deploy_address: `0x${deployment.contractAddress
        .slice(2)
        .toLowerCase()
        .padStart(64, '0')}`,
    });
  });

  it('should find the perfect metadata when only line endings differ', async () => {
    const crlfSource = FACTORY_SOURCE.replace(/\n/g, '\r\n');
    const deployment = await deployFactory(crlfSource);
    const verification = await verify(
      jsonInput({ 'Factory.sol': FACTORY_SOURCE }),
      factoryTarget,
      deployment,
    );
    expectVerification(verification, {
      status: { runtimeMatch: 'perfect', creationMatch: 'perfect' },
    });
    expect(verification.compilation).to.be.instanceOf(SlangCompilation);
    expect(verification.compilation.compilerVersion).to.equal(SLANG_VERSION);
    expect(verification.compilation.sources['Factory.sol']).to.equal(
      crlfSource,
    );
  });

  it('should remove unused sources after a match without a check compilation', async () => {
    const deployment = await deployFactory(FACTORY_SOURCE);
    const compileSpy = sinon.spy(slangCompiler, 'compile');
    try {
      const verification = await verify(
        jsonInput({
          'Factory.sol': FACTORY_SOURCE,
          'Unused.sol':
            '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract Unused {}\n',
        }),
        factoryTarget,
        deployment,
      );
      expectVerification(verification, {
        status: { runtimeMatch: 'perfect', creationMatch: 'perfect' },
      });
      expect(Object.keys(verification.compilation.sources)).to.deep.equal([
        'Factory.sol',
      ]);
      // One compilation, and one more to find the trailers of the factory
      expect(compileSpy.callCount).to.equal(2);
    } finally {
      compileSpy.restore();
    }
  });

  it('should not match a different contract', async () => {
    const deployment = await deployFactory(FACTORY_SOURCE);
    await expect(
      verify(
        jsonInput({
          'Factory.sol': FACTORY_SOURCE.replace(
            'new Child(seed)',
            'new Child(seed + 1)',
          ),
        }),
        factoryTarget,
        deployment,
      ),
    ).to.eventually.be.rejectedWith(SourcifyLibError);
  });
});
