import { describe, it } from 'mocha';
import { expect } from 'chai';
import path from 'path';
import fs from 'fs';
import { FeCompilation } from '../../src/Compilation/FeCompilation';
import { feCompiler } from '../utils';

describe('FeCompilation', () => {
  describe('Basic Verification', () => {
    const CONTRACT_NAME = 'Counter';
    const SOURCE_FILE = 'src/lib.fe';
    const COUNTER_DIR = path.join(__dirname, '..', 'sources', 'Fe', 'counter');
    const COUNTER_PATH = path.join(COUNTER_DIR, 'lib.fe');
    const artifact = JSON.parse(
      fs.readFileSync(path.join(COUNTER_DIR, 'artifact.json'), 'utf8'),
    );

    function makeCompilation(source: string): FeCompilation {
      return new FeCompilation(
        feCompiler,
        '26.0.0-alpha.10',
        {
          language: 'Fe',
          sources: {
            [SOURCE_FILE]: { content: source },
          },
        },
        {
          name: CONTRACT_NAME,
          path: SOURCE_FILE,
        },
      );
    }

    it('should compile a simple Fe contract and produce correct bytecodes', async () => {
      const compilation = makeCompilation(
        fs.readFileSync(COUNTER_PATH, 'utf8'),
      );

      await compilation.compile();

      expect(compilation.creationBytecode).to.equal('0x' + artifact.creationBytecode);
      expect(compilation.runtimeBytecode).to.equal('0x' + artifact.runtimeBytecode);
    });

    it('should set empty CBOR auxdata positions (Fe has no metadata)', async () => {
      const compilation = makeCompilation(
        fs.readFileSync(COUNTER_PATH, 'utf8'),
      );

      await compilation.compile();
      await compilation.generateCborAuxdataPositions();

      expect(compilation.creationBytecodeCborAuxdata).to.deep.equal({});
      expect(compilation.runtimeBytecodeCborAuxdata).to.deep.equal({});
    });

    it('should return empty immutableReferences, linkReferences', async () => {
      const compilation = makeCompilation(
        fs.readFileSync(COUNTER_PATH, 'utf8'),
      );

      await compilation.compile();

      expect(compilation.immutableReferences).to.deep.equal({});
      expect(compilation.runtimeLinkReferences).to.deep.equal({});
      expect(compilation.creationLinkReferences).to.deep.equal({});
    });

    it('should strip leading v from compiler version', () => {
      const compilation = new FeCompilation(
        feCompiler,
        'v26.0.0-alpha.10',
        {
          language: 'Fe',
          sources: { [SOURCE_FILE]: { content: '' } },
        },
        { name: CONTRACT_NAME, path: SOURCE_FILE },
      );

      expect(compilation.compilerVersion).to.equal('26.0.0-alpha.10');
    });

    it('should throw a compilation error for invalid Fe code', async () => {
      const compilation = makeCompilation('this is not valid Fe code @@@');

      try {
        await compilation.compile();
        expect.fail('Should have thrown a compilation error');
      } catch (error) {
        expect(error).to.exist;
      }
    });
  });

  describe('Multi-file ingot', () => {
    const MULTI_FILE_DIR = path.join(
      __dirname,
      '..',
      'sources',
      'Fe',
      'multi_file',
    );

    it('should compile a contract defined in a non-lib.fe source file', async () => {
      const compilation = new FeCompilation(
        feCompiler,
        '26.0.0-alpha.10',
        {
          language: 'Fe',
          sources: {
            'src/lib.fe': {
              content: fs.readFileSync(
                path.join(MULTI_FILE_DIR, 'src', 'lib.fe'),
                'utf8',
              ),
            },
            'src/counter.fe': {
              content: fs.readFileSync(
                path.join(MULTI_FILE_DIR, 'src', 'counter.fe'),
                'utf8',
              ),
            },
          },
        },
        { name: 'Counter', path: 'src/counter.fe' },
      );
      await compilation.compile();
      const multiArtifact = JSON.parse(
        fs.readFileSync(path.join(MULTI_FILE_DIR, 'artifact.json'), 'utf8'),
      );
      expect(compilation.creationBytecode).to.equal('0x' + multiArtifact.creationBytecode);
      expect(compilation.runtimeBytecode).to.equal('0x' + multiArtifact.runtimeBytecode);
    });
  });
});
