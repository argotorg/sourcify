import { describe, it } from 'mocha';
import { expect } from 'chai';
import {
  SlangCompilation,
  findSlangAuxdataPositions,
} from '../../src/Compilation/SlangCompilation';
import { CompilationError } from '../../src/Compilation/CompilationTypes';
import type { ISlangCompiler } from '../../src/Compilation/CompilationTypes';
import type { SlangOutput } from '@ethereum-sourcify/compilers-types';

const SLANG_VERSION = '0.2.0+slang';
const target = { path: 'A.sol', name: 'A' };
const jsonInput = { language: 'Solidity', sources: {}, settings: {} };

// A trailer of Slang 0.2.0 with the given 32-byte metadata digest
function trailer(digest: string): string {
  return `a2646970667358221220${digest}65736c616e67430002000034`;
}
// The trailer of builds before NomicFoundation/solx#897: text under the solc key
const OLD_TRAILER =
  'a2646970667358221220a3522cc0703eb0ec0d38710b9df53fd7a121eb7a2b07decd9143e248df2945f564736f6c637817736c616e673a302e322e303b736f6c633a302e382e32380048';

const DIGEST_1 = '11'.repeat(32);
const DIGEST_2 = '22'.repeat(32);
const DIGEST_3 = '33'.repeat(32);
const DIGEST_4 = '44'.repeat(32);

// A compiler that returns the given bytecode for each call, in order
function fakeCompiler(
  bytecodes: string[],
  compilerName = 'slang',
): ISlangCompiler & { calls: number } {
  const compiler = {
    calls: 0,
    compile: async () => {
      const object = bytecodes[Math.min(compiler.calls, bytecodes.length - 1)];
      compiler.calls++;
      return {
        contracts: {
          'A.sol': {
            A: {
              metadata: JSON.stringify({
                compiler: { name: compilerName, version: '0.2.0' },
              }),
              evm: {
                bytecode: { object: `6080${object}`, linkReferences: {} },
                deployedBytecode: { object, linkReferences: {} },
              },
            },
          },
        },
      } as unknown as SlangOutput;
    },
  };
  return compiler;
}

describe('SlangCompilation', () => {
  describe('findSlangAuxdataPositions', () => {
    it('should find each trailer that differs', () => {
      const original = `0x6000${trailer(DIGEST_1)}6001${trailer(DIGEST_2)}`;
      const edited = `0x6000${trailer(DIGEST_3)}6001${trailer(DIGEST_4)}`;
      expect(findSlangAuxdataPositions(original, edited)).to.deep.equal({
        '1': { offset: 2, value: `0x${trailer(DIGEST_1)}` },
        '2': { offset: 58, value: `0x${trailer(DIGEST_2)}` },
      });
    });

    it('should find a trailer whose digest differs only in the last byte', () => {
      const original = `0x6000${trailer(DIGEST_1)}`;
      const edited = `0x6000${trailer(`${'11'.repeat(31)}12`)}`;
      expect(findSlangAuxdataPositions(original, edited)).to.deep.equal({
        '1': { offset: 2, value: `0x${trailer(DIGEST_1)}` },
      });
    });

    it('should return no trailers when the bytecodes are equal', () => {
      const bytecode = `0x6000${trailer(DIGEST_1)}`;
      expect(findSlangAuxdataPositions(bytecode, bytecode)).to.deep.equal({});
    });

    it('should fail when a difference is outside a trailer', () => {
      expect(() =>
        findSlangAuxdataPositions(
          `0x6000${trailer(DIGEST_1)}`,
          `0x6001${trailer(DIGEST_1)}`,
        ),
      ).to.throw('No trailer found');
    });

    it('should fail when the lengths differ', () => {
      expect(() =>
        findSlangAuxdataPositions(`0x6000${trailer(DIGEST_1)}`, '0x6000'),
      ).to.throw('different length');
    });
  });

  it('should not request outputs that Slang rejects', () => {
    const compilation = new SlangCompilation(
      fakeCompiler([]),
      SLANG_VERSION,
      jsonInput,
      target,
    );
    const selection =
      compilation.jsonInput.settings.outputSelection?.['A.sol'].A;
    expect(selection).to.include('evm.deployedBytecode.immutableReferences');
    expect(selection).to.not.include('evm.legacyAssembly');
  });

  it('should find one trailer without a second compilation', async () => {
    const compiler = fakeCompiler([`5f5ffdfe${trailer(DIGEST_1)}`]);
    const compilation = new SlangCompilation(
      compiler,
      SLANG_VERSION,
      jsonInput,
      target,
    );
    await compilation.compile();
    await compilation.generateCborAuxdataPositions();
    expect(compilation.runtimeBytecodeCborAuxdata).to.deep.equal({
      '1': { offset: 4, value: `0x${trailer(DIGEST_1)}` },
    });
    expect(compilation.creationBytecodeCborAuxdata).to.deep.equal({
      '1': { offset: 6, value: `0x${trailer(DIGEST_1)}` },
    });
    expect(compiler.calls).to.equal(1);
  });

  it('should find the trailers of a factory with a second compilation', async () => {
    const compiler = fakeCompiler([
      `5f5ffdfe${trailer(DIGEST_1)}${trailer(DIGEST_2)}`,
      `5f5ffdfe${trailer(DIGEST_3)}${trailer(DIGEST_4)}`,
    ]);
    const compilation = new SlangCompilation(
      compiler,
      SLANG_VERSION,
      jsonInput,
      target,
    );
    await compilation.compile();
    await compilation.generateCborAuxdataPositions();
    expect(compilation.runtimeBytecodeCborAuxdata).to.deep.equal({
      '1': { offset: 4, value: `0x${trailer(DIGEST_1)}` },
      '2': { offset: 58, value: `0x${trailer(DIGEST_2)}` },
    });
    expect(compiler.calls).to.equal(2);
  });

  it('should return no trailers when the bytecode has none', async () => {
    const compilation = new SlangCompilation(
      fakeCompiler(['5f5ffdfe']),
      SLANG_VERSION,
      jsonInput,
      target,
    );
    await compilation.compile();
    await compilation.generateCborAuxdataPositions();
    expect(compilation.runtimeBytecodeCborAuxdata).to.deep.equal({});
    expect(compilation.creationBytecodeCborAuxdata).to.deep.equal({});
  });

  it('should not read contract data as a trailer when CBOR is off', async () => {
    // Without appendCBOR, the bytes at the end are data of the contract
    for (const data of [trailer(DIGEST_1), OLD_TRAILER]) {
      const compilation = new SlangCompilation(
        fakeCompiler([`5f5ffdfe${data}`]),
        SLANG_VERSION,
        { ...jsonInput, settings: { metadata: { appendCBOR: false } } },
        target,
      );
      await compilation.compile();
      await compilation.generateCborAuxdataPositions();
      expect(compilation.runtimeBytecodeCborAuxdata).to.deep.equal({});
      expect(compilation.creationBytecodeCborAuxdata).to.deep.equal({});
    }
  });

  it('should accept a pre-release version', () => {
    const compilation = new SlangCompilation(
      fakeCompiler([]),
      'v0.1.0-pre.2026-11-12+slang',
      jsonInput,
      target,
    );
    expect(compilation.compilerVersion).to.equal('0.1.0-pre.2026-11-12+slang');
  });

  it('should reject a build that writes the old trailer', async () => {
    const compilation = new SlangCompilation(
      fakeCompiler([`5f5ffdfe${OLD_TRAILER}`]),
      SLANG_VERSION,
      jsonInput,
      target,
    );
    try {
      await compilation.compile();
      expect.fail('Expected error was not thrown');
    } catch (error: any) {
      expect(error).to.be.instanceOf(CompilationError);
      expect(error.code).to.equal('unsupported_compiler_version');
    }
  });

  it('should reject an output whose metadata does not name Slang', async () => {
    const compilation = new SlangCompilation(
      fakeCompiler([`5f5ffdfe${trailer(DIGEST_1)}`], 'solar'),
      SLANG_VERSION,
      jsonInput,
      target,
    );
    try {
      await compilation.compile();
      expect.fail('Expected error was not thrown');
    } catch (error: any) {
      expect(error).to.be.instanceOf(CompilationError);
      expect(error.code).to.equal('invalid_compiler_version');
    }
  });

  it('should reject solc and Solar versions', () => {
    for (const version of [
      '0.8.28+commit.7893614a',
      '0.2.0',
      '0.8.38+commit.e7a91fc7.solar.0.3.0',
    ]) {
      expect(
        () =>
          new SlangCompilation(fakeCompiler([]), version, jsonInput, target),
      )
        .to.throw(CompilationError)
        .with.property('code', 'invalid_compiler_version');
    }
  });
});
