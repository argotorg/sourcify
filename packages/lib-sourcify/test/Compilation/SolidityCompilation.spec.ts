import { describe, it } from 'mocha';
import { expect, use } from 'chai';
import path from 'path';
import fs from 'fs';
import {
  SolidityCompilation,
  supportsHistoricalSolidityStorageLayoutExtraction,
} from '../../src/Compilation/SolidityCompilation';
import { solc } from '../utils';
import {
  CompilationError,
  type CompilationTarget,
  type ISolidityCompiler,
} from '../../src/Compilation/CompilationTypes';
import type {
  SolidityJsonInput,
  SolidityOutput,
  SolidityOutputContract,
  StorageLayout,
  Metadata,
} from '@ethereum-sourcify/compilers-types';
import chaiAsPromised from 'chai-as-promised';
import { keccak256, toUtf8Bytes } from 'ethers';

use(chaiAsPromised);

function getSolcSettingsFromMetadata(metadata: Metadata) {
  const metadataSettings = JSON.parse(JSON.stringify(metadata.settings));
  delete metadataSettings.compilationTarget;
  return metadataSettings;
}

function getCompilationTargetFromMetadata(
  metadata: Metadata,
): CompilationTarget {
  const path = Object.keys(metadata.settings.compilationTarget)[0];
  const name = metadata.settings.compilationTarget[path];
  return {
    name,
    path,
  };
}

describe('SolidityCompilation', () => {
  it('recovers historical layouts only when bytecode binds the source metadata', () => {
    expect(
      supportsHistoricalSolidityStorageLayoutExtraction(
        '0.4.6+commit.2dabbdf0',
      ),
    ).to.equal(false);
    expect(
      supportsHistoricalSolidityStorageLayoutExtraction(
        '0.4.7+commit.822622cf',
      ),
    ).to.equal(true);
    expect(
      supportsHistoricalSolidityStorageLayoutExtraction(
        '0.5.12+commit.7709ece9',
      ),
    ).to.equal(true);
    expect(
      supportsHistoricalSolidityStorageLayoutExtraction(
        '0.5.13+commit.5b0b510c',
      ),
    ).to.equal(false);
  });

  it('should compile a simple contract', async () => {
    const contractPath = path.join(__dirname, '..', 'sources', 'Storage');
    const metadata = JSON.parse(
      fs.readFileSync(path.join(contractPath, 'metadata.json'), 'utf8'),
    );
    const sources = {
      'project:/contracts/Storage.sol': {
        content: fs.readFileSync(
          path.join(contractPath, 'sources', 'Storage.sol'),
          'utf8',
        ),
      },
    };

    const compilation = new SolidityCompilation(
      solc,
      metadata.compiler.version,
      {
        language: 'Solidity',
        sources,
        settings: getSolcSettingsFromMetadata(metadata),
      },
      getCompilationTargetFromMetadata(metadata),
    );

    await compilation.compile();
    expect(compilation.creationBytecode).to.equal(
      '0x608060405234801561001057600080fd5b5061012f806100206000396000f3fe6080604052348015600f57600080fd5b506004361060325760003560e01c80632e64cec11460375780636057361d146051575b600080fd5b603d6069565b6040516048919060c2565b60405180910390f35b6067600480360381019060639190608f565b6072565b005b60008054905090565b8060008190555050565b60008135905060898160e5565b92915050565b60006020828403121560a057600080fd5b600060ac84828501607c565b91505092915050565b60bc8160db565b82525050565b600060208201905060d5600083018460b5565b92915050565b6000819050919050565b60ec8160db565b811460f657600080fd5b5056fea264697066735822122005183dd5df276b396683ae62d0c96c3a406d6f9dad1ad0923daf492c531124b164736f6c63430008040033',
    );
    expect(compilation.runtimeBytecode).to.equal(
      '0x6080604052348015600f57600080fd5b506004361060325760003560e01c80632e64cec11460375780636057361d146051575b600080fd5b603d6069565b6040516048919060c2565b60405180910390f35b6067600480360381019060639190608f565b6072565b005b60008054905090565b8060008190555050565b60008135905060898160e5565b92915050565b60006020828403121560a057600080fd5b600060ac84828501607c565b91505092915050565b60bc8160db565b82525050565b600060208201905060d5600083018460b5565b92915050565b6000819050919050565b60ec8160db565b811460f657600080fd5b5056fea264697066735822122005183dd5df276b396683ae62d0c96c3a406d6f9dad1ad0923daf492c531124b164736f6c63430008040033',
    );
  });

  it('should generate correct CBOR auxdata positions', async () => {
    const contractPath = path.join(__dirname, '..', 'sources', 'Storage');
    const metadata = JSON.parse(
      fs.readFileSync(path.join(contractPath, 'metadata.json'), 'utf8'),
    );
    const sources = {
      'project:/contracts/Storage.sol': {
        content: fs.readFileSync(
          path.join(contractPath, 'sources', 'Storage.sol'),
          'utf8',
        ),
      },
    };

    const compilation = new SolidityCompilation(
      solc,
      metadata.compiler.version,
      {
        language: 'Solidity',
        sources,
        settings: getSolcSettingsFromMetadata(metadata),
      },
      getCompilationTargetFromMetadata(metadata),
    );

    await compilation.compile();

    await compilation.generateCborAuxdataPositions();
    expect(compilation.runtimeBytecodeCborAuxdata).to.deep.equal({
      '1': {
        offset: 250,
        value:
          '0xa264697066735822122005183dd5df276b396683ae62d0c96c3a406d6f9dad1ad0923daf492c531124b164736f6c63430008040033',
      },
    });
    expect(compilation.creationBytecodeCborAuxdata).to.deep.equal({
      '1': {
        offset: 282,
        value:
          '0xa264697066735822122005183dd5df276b396683ae62d0c96c3a406d6f9dad1ad0923daf492c531124b164736f6c63430008040033',
      },
    });
  });

  it('should handle multiple auxdatas correctly', async () => {
    const contractPath = path.join(
      __dirname,
      '..',
      'sources',
      'WithMultipleAuxdatas',
    );
    const metadata = JSON.parse(
      fs.readFileSync(path.join(contractPath, 'metadata.json'), 'utf8'),
    );

    // Need to read all source files referenced in metadata
    const sources: { [key: string]: { content: string } } = {};
    for (const [sourcePath] of Object.entries(metadata.sources)) {
      const fullPath = path.join(
        contractPath,
        'sources',
        path.basename(sourcePath),
      );
      sources[sourcePath] = {
        content: fs.readFileSync(fullPath, 'utf8'),
      };
    }

    const compilation = new SolidityCompilation(
      solc,
      metadata.compiler.version,
      {
        language: 'Solidity',
        sources,
        settings: getSolcSettingsFromMetadata(metadata),
      },
      getCompilationTargetFromMetadata(metadata),
    );

    await compilation.compile();

    await compilation.generateCborAuxdataPositions();

    expect(compilation.runtimeBytecodeCborAuxdata).to.deep.equal({
      '1': {
        offset: 4116,
        value:
          '0xa26469706673582212203f80215daaa57bc563fda2c3949f4197328f188fccab68874ea57b874c93bd4f64736f6c63430008090033',
      },
      '2': {
        offset: 2743,
        value:
          '0xa264697066735822122062aefa28f677414dcac37f95b9b8ce7fcf373fd22d1bae136401de85504508e764736f6c63430008090033',
      },
      '3': {
        offset: 4063,
        value:
          '0xa2646970667358221220eb4312065a8c0fb940ef11ef5853554a447a5325095ee0f8fbbbbfc43dbb1b7464736f6c63430008090033',
      },
    });
    expect(compilation.creationBytecodeCborAuxdata).to.deep.equal({
      '1': {
        offset: 4148,
        value:
          '0xa26469706673582212203f80215daaa57bc563fda2c3949f4197328f188fccab68874ea57b874c93bd4f64736f6c63430008090033',
      },
      '2': {
        offset: 2775,
        value:
          '0xa264697066735822122062aefa28f677414dcac37f95b9b8ce7fcf373fd22d1bae136401de85504508e764736f6c63430008090033',
      },
      '3': {
        offset: 4095,
        value:
          '0xa2646970667358221220eb4312065a8c0fb940ef11ef5853554a447a5325095ee0f8fbbbbfc43dbb1b7464736f6c63430008090033',
      },
    });
  });

  it('should generate auxdata positions when sources carry a keccak256 integrity hash', async () => {
    // Regression test: a Standard-JSON input (e.g. imported from Etherscan) can carry a
    // `keccak256` integrity hash for each source. Generating the cbor auxdata positions for
    // a contract with multiple auxdatas recompiles an *edited* copy of the sources (a trailing
    // space is appended to each) to diff the metadata hashes. The stale `keccak256` must be
    // dropped for that recompilation, otherwise solc rejects the edited source with
    // "Mismatch between content and supplied hash" and no positions can be generated.
    const contractPath = path.join(
      __dirname,
      '..',
      'sources',
      'WithMultipleAuxdatas',
    );
    const metadata = JSON.parse(
      fs.readFileSync(path.join(contractPath, 'metadata.json'), 'utf8'),
    );

    const sources: { [key: string]: { keccak256: string; content: string } } =
      {};
    for (const [sourcePath] of Object.entries(metadata.sources)) {
      const content = fs.readFileSync(
        path.join(contractPath, 'sources', path.basename(sourcePath)),
        'utf8',
      );
      // Populate the keccak256 integrity hash the way an Etherscan Standard-JSON input does
      sources[sourcePath] = {
        keccak256: keccak256(toUtf8Bytes(content)),
        content,
      };
    }

    const compilation = new SolidityCompilation(
      solc,
      metadata.compiler.version,
      {
        language: 'Solidity',
        sources,
        settings: getSolcSettingsFromMetadata(metadata),
      },
      getCompilationTargetFromMetadata(metadata),
    );

    await compilation.compile();
    // Before the fix this rejected with "Cannot generate cbor auxdata positions."
    await compilation.generateCborAuxdataPositions();

    expect(
      Object.keys(compilation.runtimeBytecodeCborAuxdata),
    ).to.have.lengthOf(3);
    expect(
      Object.keys(compilation.creationBytecodeCborAuxdata),
    ).to.have.lengthOf(3);
  });

  it('should handle case with no auxdata when metadata is disabled', async () => {
    const contractPath = path.join(__dirname, '..', 'sources', 'Storage');
    const metadata = JSON.parse(
      fs.readFileSync(path.join(contractPath, 'metadata.json'), 'utf8'),
    );
    const sources = {
      'project:/contracts/Storage.sol': {
        content: fs.readFileSync(
          path.join(contractPath, 'sources', 'Storage.sol'),
          'utf8',
        ),
      },
    };

    const solcJsonInput: SolidityJsonInput = {
      language: 'Solidity',
      sources,
      settings: {
        // Disable metadata output
        metadata: {
          appendCBOR: false,
        },
        outputSelection: {
          '*': {
            '*': ['*'],
          },
        },
      },
    };

    const compilation = new SolidityCompilation(
      solc,
      '0.8.19+commit.7dd6d404', // Force compiler version compatible with appendCBOR
      solcJsonInput,
      getCompilationTargetFromMetadata(metadata),
    );

    await compilation.compile();
    await compilation.generateCborAuxdataPositions();

    expect(compilation.creationBytecodeCborAuxdata).to.deep.equal({});
    expect(compilation.runtimeBytecodeCborAuxdata).to.deep.equal({});
  });

  it('should throw when compilation target is invalid', async () => {
    const contractPath = path.join(__dirname, '..', 'sources', 'Storage');
    const metadata = JSON.parse(
      fs.readFileSync(path.join(contractPath, 'metadata.json'), 'utf8'),
    );
    const sources = {
      'project:/contracts/Storage.sol': {
        content: fs.readFileSync(
          path.join(contractPath, 'sources', 'Storage.sol'),
          'utf8',
        ),
      },
    };

    const compilation = new SolidityCompilation(
      solc,
      metadata.compiler.version,
      {
        language: 'Solidity',
        sources,
        settings: getSolcSettingsFromMetadata(metadata),
      },
      { name: 'NonExistentContract', path: 'Storage.sol' },
    );

    await expect(compilation.compile()).to.be.eventually.rejectedWith(
      'Contract not found in compiler output',
    );
  });

  it('should return empty object when no immutable references exist', async () => {
    const contractPath = path.join(
      __dirname,
      '..',
      'sources',
      'NoImmutableField',
    );
    const metadata = JSON.parse(
      fs.readFileSync(path.join(contractPath, 'metadata.json'), 'utf8'),
    );
    const sources = {
      'NoImmutable.sol': {
        content: fs.readFileSync(
          path.join(contractPath, 'sources', 'NoImmutable.sol'),
          'utf8',
        ),
      },
    };

    const compilation = new SolidityCompilation(
      solc,
      metadata.compiler.version,
      {
        language: 'Solidity',
        sources,
        settings: getSolcSettingsFromMetadata(metadata),
      },
      getCompilationTargetFromMetadata(metadata),
    );

    await compilation.compile();
    const immutableRefs = compilation.immutableReferences;
    expect(immutableRefs).to.deep.equal({});
  });

  it('should return immutable references when they exist', async () => {
    const contractPath = path.join(
      __dirname,
      '..',
      'sources',
      'WithImmutables',
    );
    const metadata = JSON.parse(
      fs.readFileSync(path.join(contractPath, 'metadata.json'), 'utf8'),
    );
    const sources = {
      'contracts/WithImmutables.sol': {
        content: fs.readFileSync(
          path.join(contractPath, 'sources', 'WithImmutables.sol'),
          'utf8',
        ),
      },
    };

    const compilation = new SolidityCompilation(
      solc,
      metadata.compiler.version,
      {
        language: 'Solidity',
        sources,
        settings: getSolcSettingsFromMetadata(metadata),
      },
      getCompilationTargetFromMetadata(metadata),
    );

    await compilation.compile();
    const immutableRefs = compilation.immutableReferences;
    expect(immutableRefs).to.deep.equal({ '3': [{ length: 32, start: 608 }] });
  });

  it('should clean compiler version with v prefix', () => {
    const contractPath = path.join(__dirname, '..', 'sources', 'Storage');
    const metadata = JSON.parse(
      fs.readFileSync(path.join(contractPath, 'metadata.json'), 'utf8'),
    );
    const sources = {
      'project:/contracts/Storage.sol': {
        content: fs.readFileSync(
          path.join(contractPath, 'sources', 'Storage.sol'),
          'utf8',
        ),
      },
    };

    const compilation = new SolidityCompilation(
      solc,
      'v0.8.4+commit.c7e474f2',
      {
        language: 'Solidity',
        sources,
        settings: getSolcSettingsFromMetadata(metadata),
      },
      getCompilationTargetFromMetadata(metadata),
    );

    expect(compilation.compilerVersion).to.equal('0.8.4+commit.c7e474f2');
  });

  // Contracts before 0.4.12 don't have `auxdata` in `legacyAssembly`
  // https://github.com/argotorg/sourcify/issues/2217
  it('should handle legacy Solidity 0.4.11 contracts with auxdata correctly', async () => {
    const contractPath = path.join(__dirname, '..', 'sources', '0.4.x');
    const sources = {
      'Multidrop.sol': {
        content: fs.readFileSync(
          path.join(contractPath, 'Multidrop.sol'),
          'utf8',
        ),
      },
    };

    const solcJsonInput: SolidityJsonInput = {
      language: 'Solidity',
      sources,
      settings: {
        optimizer: {
          enabled: false,
          runs: 200,
        },
        outputSelection: {
          '*': {
            '*': ['*'],
          },
        },
      },
    };

    const compilation = new SolidityCompilation(
      solc,
      '0.4.11+commit.68ef5810', // Solidity 0.4.11
      solcJsonInput,
      {
        name: 'Multidrop',
        path: 'Multidrop.sol',
      },
    );

    await compilation.compile();

    const storageLayout = (
      compilation.contractCompilerOutput as SolidityOutputContract
    ).storageLayout;
    const owner = storageLayout?.storage.find(({ label }) => label === 'owner');
    expect(owner).to.include({
      contract: 'Multidrop.sol:Multidrop',
      label: 'owner',
      offset: 0,
      slot: '0',
      type: 't_address',
    });

    await compilation.generateCborAuxdataPositions();

    // For Solidity 0.4.11, auxdata should be extracted from bytecode directly
    // The auxdata positions should be calculated correctly even though legacyAssembly doesn't have .auxdata field
    expect(compilation.runtimeBytecodeCborAuxdata).to.not.deep.equal({});
    expect(compilation.creationBytecodeCborAuxdata).to.not.deep.equal({});

    // Verify that auxdata positions are properly structured
    if (Object.keys(compilation.runtimeBytecodeCborAuxdata).length > 0) {
      expect(compilation.runtimeBytecodeCborAuxdata['1']).to.have.property(
        'offset',
      );
      expect(compilation.runtimeBytecodeCborAuxdata['1']).to.have.property(
        'value',
      );
      expect(compilation.runtimeBytecodeCborAuxdata['1'].value).to.match(
        /^0x[a-fA-F0-9]+$/,
      );
    }

    if (Object.keys(compilation.creationBytecodeCborAuxdata).length > 0) {
      expect(compilation.creationBytecodeCborAuxdata['1']).to.have.property(
        'offset',
      );
      expect(compilation.creationBytecodeCborAuxdata['1']).to.have.property(
        'value',
      );
      expect(compilation.creationBytecodeCborAuxdata['1'].value).to.match(
        /^0x[a-fA-F0-9]+$/,
      );
    }
  });

  it('should attach a recovered historical storage layout', async () => {
    const recoveredLayout: StorageLayout = {
      storage: [
        {
          astId: 1,
          contract: 'Legacy.sol:Legacy',
          label: 'value',
          offset: 0,
          slot: '0',
          type: 't_uint256',
        },
      ],
      types: {
        t_uint256: {
          encoding: 'inplace',
          label: 'uint256',
          numberOfBytes: '32',
        },
      },
    };
    let extractionCalls = 0;
    const compiler: ISolidityCompiler = {
      async compile() {
        return emptySolidityOutput();
      },
      async extractStorageLayout() {
        extractionCalls += 1;
        return recoveredLayout;
      },
    };
    const compilation = new SolidityCompilation(
      compiler,
      '0.5.12+commit.7709ece9',
      basicSolidityInput(),
      { path: 'Legacy.sol', name: 'Legacy' },
    );

    expect(
      compilation.jsonInput.settings.outputSelection?.['*']?.[''],
    ).to.deep.equal(['ast']);
    await compilation.compile();

    expect(extractionCalls).to.equal(1);
    expect(
      (compilation.contractCompilerOutput as SolidityOutputContract)
        .storageLayout,
    ).to.deep.equal(recoveredLayout);
  });

  it('should preserve native storage layouts without invoking recovery', async () => {
    const nativeLayout: StorageLayout = { storage: [], types: null };
    let extractionCalls = 0;
    const compiler: ISolidityCompiler = {
      async compile() {
        return emptySolidityOutput(nativeLayout);
      },
      async extractStorageLayout() {
        extractionCalls += 1;
        throw new Error('must not run');
      },
    };
    const compilation = new SolidityCompilation(
      compiler,
      '0.5.12+commit.7709ece9',
      basicSolidityInput(),
      { path: 'Legacy.sol', name: 'Legacy' },
    );

    await compilation.compile();

    expect(extractionCalls).to.equal(0);
    expect(
      (compilation.contractCompilerOutput as SolidityOutputContract)
        .storageLayout,
    ).to.equal(nativeLayout);
  });

  it('should leave the layout absent when historical recovery fails', async () => {
    const compiler: ISolidityCompiler = {
      async compile() {
        return emptySolidityOutput();
      },
      async extractStorageLayout() {
        throw new Error('unresolved historical type');
      },
    };
    const compilation = new SolidityCompilation(
      compiler,
      '0.4.11+commit.68ef5810',
      basicSolidityInput(),
      { path: 'Legacy.sol', name: 'Legacy' },
    );

    expect(
      compilation.jsonInput.settings.outputSelection?.['*']?.[''],
    ).to.deep.equal(['legacyAST']);
    await compilation.compile();

    expect(
      (compilation.contractCompilerOutput as SolidityOutputContract)
        .storageLayout,
    ).to.equal(undefined);
  });

  it('should not request historical ASTs for native layout versions', () => {
    const compilation = new SolidityCompilation(
      {
        async compile() {
          return emptySolidityOutput();
        },
      },
      '0.5.13+commit.5b0b510c',
      basicSolidityInput(),
      { path: 'Legacy.sol', name: 'Legacy' },
    );

    expect(
      compilation.jsonInput.settings.outputSelection?.['*']?.[''],
    ).to.equal(undefined);
  });

  it('should output transientStorageLayout for contracts with transient storage variables', async () => {
    const source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
contract TransientStorage {
    uint256 transient public counter;
    function increment() external { counter++; }
}`;

    const solcJsonInput: SolidityJsonInput = {
      language: 'Solidity',
      sources: { 'TransientStorage.sol': { content: source } },
      settings: {},
    };

    const compilation = new SolidityCompilation(
      solc,
      '0.8.28+commit.7893614a',
      solcJsonInput,
      { name: 'TransientStorage', path: 'TransientStorage.sol' },
    );

    await compilation.compile();

    const contractOutput =
      compilation.contractCompilerOutput as SolidityOutputContract;
    expect(contractOutput.transientStorageLayout).to.exist;
    expect(
      contractOutput.transientStorageLayout?.storage,
    ).to.have.length.greaterThan(0);
  });

  it('should throw CompilationError for unsupported compiler versions < 0.1.3', () => {
    const contractPath = path.join(__dirname, '..', 'sources', '0.1.2');
    const sources = {
      'Simple.sol': {
        content: fs.readFileSync(path.join(contractPath, 'Simple.sol'), 'utf8'),
      },
    };

    const solcJsonInput: SolidityJsonInput = {
      language: 'Solidity',
      sources,
      settings: {
        outputSelection: {
          '*': {
            '*': ['*'],
          },
        },
      },
    };
    expect(() => {
      new SolidityCompilation(solc, '0.1.2+commit.d0d36e3', solcJsonInput, {
        name: 'Simple',
        path: 'Simple.sol',
      });
    })
      .to.throw(CompilationError)
      .with.property('code', 'unsupported_compiler_version');
  });

  it('should support solidity versions with no auxdata', async () => {
    const contractPath = path.join(__dirname, '..', 'sources', '0.4.x');
    const sources = {
      'Simple.sol': {
        content: fs.readFileSync(path.join(contractPath, 'Simple.sol'), 'utf8'),
      },
    };

    const solcJsonInput: SolidityJsonInput = {
      language: 'Solidity',
      sources,
      settings: {
        outputSelection: {
          '*': {
            '*': ['*'],
          },
        },
      },
    };

    const compilation = new SolidityCompilation(
      solc,
      '0.4.2+commit.af6afb04',
      solcJsonInput,
      {
        name: 'Simple',
        path: 'Simple.sol',
      },
    );

    await compilation.compile();
    await compilation.generateCborAuxdataPositions();

    expect(compilation.runtimeBytecodeCborAuxdata).to.deep.equal({});
    expect(compilation.creationBytecodeCborAuxdata).to.deep.equal({});
  });
});

function basicSolidityInput(): SolidityJsonInput {
  return {
    language: 'Solidity',
    sources: { 'Legacy.sol': { content: 'contract Legacy { uint value; }' } },
    settings: {},
  };
}

function emptySolidityOutput(storageLayout?: StorageLayout): SolidityOutput {
  return {
    contracts: {
      'Legacy.sol': {
        Legacy: {
          abi: [],
          ...(storageLayout ? { storageLayout } : {}),
          evm: {
            bytecode: { object: '' },
            deployedBytecode: { object: '' },
          },
        },
      },
    },
    sources: { 'Legacy.sol': { id: 0 } },
  };
}
