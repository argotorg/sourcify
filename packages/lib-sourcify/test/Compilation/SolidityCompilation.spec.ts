import { describe, it } from 'mocha';
import { expect, use } from 'chai';
import path from 'path';
import fs from 'fs';
import { SolidityCompilation } from '../../src/Compilation/SolidityCompilation';
import { solc } from '../utils';
import { CompilationTarget } from '../../src/Compilation/CompilationTypes';
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
});
