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
import { SolarCompilation } from '../../src/Compilation/SolarCompilation';
import type { SolarJsonInput } from '../../src';
import { SourcifyChain, SourcifyLibError } from '../../src';
import { deployFeContract, expectVerification, solarCompiler } from '../utils';

use(chaiAsPromised);

const SOLAR_VERSION = '0.8.38+commit.e7a91fc7.solar.0.3.0';

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

const target = { path: 'Factory.sol', name: 'Factory' };

function jsonInput(sources: Record<string, string>): SolarJsonInput {
  return {
    language: 'Solidity',
    sources: Object.fromEntries(
      Object.entries(sources).map(([path, content]) => [path, { content }]),
    ),
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
    },
  };
}

describe('SolarVerification', () => {
  let hardhatNodeProcess: ChildProcess;
  let signer: JsonRpcSigner;

  before(async () => {
    hardhatNodeProcess = await startHardhatNetwork(HARDHAT_PORT);
    signer = await sourcifyChain.rpcs[0].provider!.getSigner();
  });

  after(async () => {
    await stopHardhatNetwork(hardhatNodeProcess);
  });

  // Compiles with Solar and deploys with the constructor argument 42
  async function deploy(source: string) {
    const compilation = new SolarCompilation(
      solarCompiler,
      SOLAR_VERSION,
      jsonInput({ 'Factory.sol': source }),
      target,
    );
    await compilation.compile();
    const args = AbiCoder.defaultAbiCoder().encode(['uint256'], [42]);
    return await deployFeContract(
      signer,
      compilation.creationBytecode + args.slice(2),
    );
  }

  async function verify(
    sources: Record<string, string>,
    deployment: { contractAddress: string; txHash: string },
    version = SOLAR_VERSION,
  ) {
    const compilation = new SolarCompilation(
      solarCompiler,
      version,
      jsonInput(sources),
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
    const deployment = await deploy(FACTORY_SOURCE);
    const verification = await verify(
      { 'Factory.sol': FACTORY_SOURCE },
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
  });

  it('should partially match when only a comment differs', async () => {
    const deployment = await deploy(FACTORY_SOURCE);
    const verification = await verify(
      { 'Factory.sol': FACTORY_SOURCE + '// a comment\n' },
      deployment,
    );
    expectVerification(verification, {
      status: { runtimeMatch: 'partial', creationMatch: 'partial' },
    });
  });

  it('should store the version from the metadata when the request emulates another solc version', async () => {
    const deployment = await deploy(FACTORY_SOURCE);
    const verification = await verify(
      { 'Factory.sol': FACTORY_SOURCE },
      deployment,
      // Same build as SOLAR_VERSION, only the solc part differs
      '0.8.36+commit.e7a91fc7.solar.0.3.0',
    );
    expectVerification(verification, {
      status: { runtimeMatch: 'perfect', creationMatch: 'perfect' },
    });
    expect(verification.compilation.compilerVersion).to.equal(SOLAR_VERSION);
  });

  it('should find the perfect metadata when only line endings differ', async () => {
    const crlfSource = FACTORY_SOURCE.replace(/\n/g, '\r\n');
    const deployment = await deploy(crlfSource);
    const verification = await verify(
      { 'Factory.sol': FACTORY_SOURCE },
      deployment,
    );
    expectVerification(verification, {
      status: { runtimeMatch: 'perfect', creationMatch: 'perfect' },
    });
    expect(verification.compilation).to.be.instanceOf(SolarCompilation);
    expect(verification.compilation.sources['Factory.sol']).to.equal(
      crlfSource,
    );
  });

  it('should remove unused sources after a match without a check compilation', async () => {
    const deployment = await deploy(FACTORY_SOURCE);
    // Solar does not have the extra-file-input bug, so one compilation is enough
    const compileSpy = sinon.spy(solarCompiler, 'compile');
    try {
      const verification = await verify(
        {
          'Factory.sol': FACTORY_SOURCE,
          'Unused.sol':
            '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract Unused {}\n',
        },
        deployment,
      );
      expectVerification(verification, {
        status: { runtimeMatch: 'perfect', creationMatch: 'perfect' },
      });
      expect(Object.keys(verification.compilation.sources)).to.deep.equal([
        'Factory.sol',
      ]);
      expect(compileSpy.callCount).to.equal(1);
    } finally {
      compileSpy.restore();
    }
  });

  it('should not match a different contract', async () => {
    const deployment = await deploy(FACTORY_SOURCE);
    await expect(
      verify(
        {
          'Factory.sol': FACTORY_SOURCE.replace(
            'new Child(seed)',
            'new Child(seed + 1)',
          ),
        },
        deployment,
      ),
    )
      .to.eventually.be.rejectedWith(SourcifyLibError)
      .and.have.property('code', 'bytecode_length_mismatch');
  });
});
