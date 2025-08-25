import { describe, it } from 'mocha';
import { expect, use } from 'chai';
import path from 'path';
import fs from 'fs';
import { SolidityCompilation } from '../../src/Compilation/SolidityCompilation';
import { solc } from '../utils';
import {
  CompilationTarget,
  CompilationError,
} from '../../src/Compilation/CompilationTypes';
import {
  SolidityJsonInput,
  Metadata,
} from '@ethereum-sourcify/compilers-types';
import chaiAsPromised from 'chai-as-promised';

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
  // https://github.com/ethereum/sourcify/issues/2217
  it('should handle legacy Solidity 0.4.11 contracts with auxdata correctly', async () => {
    const contractPath = path.join(__dirname, '..', 'sources', 'pre-0.4.11');
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

  it('should throw CompilationError for unsupported compiler versions < 0.4.11', () => {
    const contractPath = path.join(__dirname, '..', 'sources', 'pre-0.4.11');
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
      new SolidityCompilation(solc, '0.4.6+commit.2dabbdf0', solcJsonInput, {
        name: 'Simple',
        path: 'Simple.sol',
      });
    })
      .to.throw(CompilationError)
      .with.property('code', 'unsupported_compiler_version');
  });
});
