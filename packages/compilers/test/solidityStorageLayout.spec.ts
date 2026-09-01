import { expect } from 'chai';
import solc from 'solc';
import type {
  SolidityJsonInput,
  SolidityOutput,
} from '@ethereum-sourcify/compilers-types';
import {
  generateHistoricalSolidityStorageLayout,
  supportsHistoricalSolidityStorageLayout,
} from '../src/lib/solidityStorageLayout';

describe('historical Solidity storage layouts', () => {
  it('supports only the pre-native 0.4.x and 0.5.x range', () => {
    expect(supportsHistoricalSolidityStorageLayout('0.3.6')).to.equal(false);
    expect(supportsHistoricalSolidityStorageLayout('0.4.0')).to.equal(true);
    expect(
      supportsHistoricalSolidityStorageLayout(
        '0.5.13-nightly.2019.10.15+commit.abc12345',
      ),
    ).to.equal(true);
    expect(supportsHistoricalSolidityStorageLayout('0.5.13')).to.equal(false);
  });

  it('matches native layout for packing, inheritance, arrays, mappings and structs', () => {
    const source = `
      pragma solidity >=0.5.0;
      contract Other {}
      contract $Other {}
      contract A_$_B {}
      contract Base {
        enum E { A, B, C }
        struct Inner { uint8 x; uint16 y; }
        struct A_storage { uint256 x; }
        struct Outer {
          Inner inner;
          uint8[5] packed;
          mapping(address => uint256) map;
        }
        uint8 c1;
        uint256 constant SKIP = 3;
        E e;
        bytes3 fixedBytes;
        address addr;
        Other other;
        uint256 constant N = 5;
        uint8[N] packed;
        uint16[2][3] nested;
        bytes data;
        string text;
        mapping(address => Outer) map;
        Outer outer;
        function(uint256, bytes32) external returns (bool) callback;
        function($Other) external callbackWithDollarType;
        function(A_$_B) external callbackWithEscapedDollarType;
        function(uint256[][2] calldata) external callbackWithArray;
        function(mapping(address => uint256) storage) internal callbackWithMapping;
        function(A_storage memory) internal callbackWithStorageInTypeName;
        function() external payable callbackPayable;
        function(uint8) internal pure returns (bytes4) internalCallback;
      }
      contract Sibling { uint128 z; }
      contract Child is Sibling, Base { bool tail; }
    `;
    const input: SolidityJsonInput = {
      language: 'Solidity',
      sources: { 'Probe.sol': { content: source } },
      settings: {
        outputSelection: {
          '*': {
            '': ['ast'],
            '*': ['storageLayout'],
          },
        },
      },
    };
    const output = JSON.parse(
      solc.compile(JSON.stringify(input)),
    ) as SolidityOutput;
    expect(
      output.errors?.filter((error) => error.severity === 'error'),
    ).to.deep.equal([]);

    const reconstructed = generateHistoricalSolidityStorageLayout(
      '0.5.12+commit.7709ece9',
      input,
      output,
      { path: 'Probe.sol', name: 'Child' },
    );
    const native = output.contracts['Probe.sol'].Child.storageLayout;

    expect(reconstructed).to.deep.equal(native);
  });

  it('normalizes legacy ASTs and excludes constants from their source span', () => {
    const source =
      '// 😀😀😀😀😀😀😀😀\n' +
      'contract Base { uint8 a; uint256 constant SKIP = 1; uint16 b; } ' +
      'contract Child is Base { bool c; }';
    const variable = (
      id: number,
      name: string,
      type: string,
    ): Record<string, unknown> => {
      const declarationStart = source.indexOf(
        name === 'SKIP' ? 'uint256 constant SKIP' : `${type} ${name}`,
      );
      const declarationEnd = source.indexOf(';', declarationStart) + 1;
      const byteStart = Buffer.byteLength(
        source.slice(0, declarationStart),
        'utf8',
      );
      const byteLength = Buffer.byteLength(
        source.slice(declarationStart, declarationEnd),
        'utf8',
      );
      return {
        id,
        name: 'VariableDeclaration',
        attributes: { name, type },
        src: `${byteStart}:${byteLength}:0`,
        children: [
          {
            id: id + 1000,
            name: 'ElementaryTypeName',
            attributes: { name: type },
          },
        ],
      };
    };
    const input: SolidityJsonInput = {
      language: 'Solidity',
      sources: { 'Legacy.sol': { content: source } },
      settings: {},
    };
    const output = {
      contracts: {},
      sources: {
        'Legacy.sol': {
          id: 0,
          legacyAST: {
            id: 500,
            name: 'SourceUnit',
            children: [
              {
                id: 100,
                name: 'ContractDefinition',
                attributes: {
                  name: 'Base',
                  linearizedBaseContracts: [100],
                },
                children: [
                  variable(1, 'a', 'uint8'),
                  variable(2, 'SKIP', 'uint256'),
                  variable(3, 'b', 'uint16'),
                ],
              },
              {
                id: 200,
                name: 'ContractDefinition',
                attributes: {
                  name: 'Child',
                  linearizedBaseContracts: [200, 100],
                },
                children: [variable(4, 'c', 'bool')],
              },
            ],
          },
        },
      },
    } as unknown as SolidityOutput;

    const layout = generateHistoricalSolidityStorageLayout(
      '0.4.0+commit.acd334c9',
      input,
      output,
      { path: 'Legacy.sol', name: 'Child' },
    );

    expect(layout?.storage).to.deep.equal([
      {
        astId: 1,
        contract: 'Legacy.sol:Child',
        label: 'a',
        offset: 0,
        slot: '0',
        type: 't_uint8',
      },
      {
        astId: 3,
        contract: 'Legacy.sol:Child',
        label: 'b',
        offset: 1,
        slot: '0',
        type: 't_uint16',
      },
      {
        astId: 4,
        contract: 'Legacy.sol:Child',
        label: 'c',
        offset: 3,
        slot: '0',
        type: 't_bool',
      },
    ]);
  });

  it('resolves library types from the legacy AST dialect', () => {
    const input: SolidityJsonInput = {
      language: 'Solidity',
      sources: {
        'Library.sol': {
          content: 'library L {} contract C { L value; }',
        },
      },
      settings: {},
    };
    const output = {
      contracts: {},
      sources: {
        'Library.sol': {
          id: 0,
          legacyAST: {
            id: 500,
            name: 'SourceUnit',
            children: [
              {
                id: 100,
                name: 'ContractDefinition',
                attributes: {
                  isLibrary: true,
                  name: 'L',
                  linearizedBaseContracts: [100],
                },
                children: [],
              },
              {
                id: 200,
                name: 'ContractDefinition',
                attributes: {
                  name: 'C',
                  linearizedBaseContracts: [200],
                },
                children: [
                  {
                    id: 1,
                    name: 'VariableDeclaration',
                    attributes: {
                      constant: false,
                      name: 'value',
                      type: 'library L',
                    },
                    children: [
                      {
                        id: 2,
                        name: 'UserDefinedTypeName',
                        attributes: { name: 'L' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    } as unknown as SolidityOutput;

    const layout = generateHistoricalSolidityStorageLayout(
      '0.4.11+commit.68ef5810',
      input,
      output,
      { path: 'Library.sol', name: 'C' },
    );

    expect(layout?.storage[0]).to.include({
      offset: 0,
      slot: '0',
      type: 't_contract(L)100',
    });
    expect(layout?.types?.['t_contract(L)100']).to.deep.equal({
      encoding: 'inplace',
      label: 'library L',
      numberOfBytes: '20',
    });
  });

  it('builds canonical function identifiers from legacy parameter lists', () => {
    const input: SolidityJsonInput = {
      language: 'Solidity',
      sources: {
        'Functions.sol': {
          content:
            'contract C { function(uint256, bytes32) external returns (bool) cb; ' +
            'function(uint8) internal constant returns (bytes4) icb; }',
        },
      },
      settings: {},
    };
    const output = legacyContractOutput('Functions.sol', 'C', [
      legacyFunctionVariable(
        1,
        'cb',
        'external',
        false,
        ['uint256', 'bytes32'],
        ['bool'],
      ),
      legacyFunctionVariable(
        20,
        'icb',
        'internal',
        true,
        ['uint8'],
        ['bytes4'],
      ),
    ]);

    const layout = generateHistoricalSolidityStorageLayout(
      '0.4.11+commit.68ef5810',
      input,
      output,
      { path: 'Functions.sol', name: 'C' },
    );

    expect(
      layout?.storage.map(({ offset, slot, type }) => ({
        offset,
        slot,
        type,
      })),
    ).to.deep.equal([
      {
        offset: 0,
        slot: '0',
        type: 't_function_external_nonpayable(t_uint256,t_bytes32)returns(t_bool)',
      },
      {
        offset: 24,
        slot: '0',
        type: 't_function_internal_view(t_uint8)returns(t_bytes4)',
      },
    ]);
  });

  it('normalizes the compact AST isDeclaredConst function flag', () => {
    const parameter = (id: number, type: string) => ({
      id,
      nodeType: 'VariableDeclaration',
      name: '',
      typeDescriptions: { typeString: type },
      typeName: {
        id: id + 100,
        name: type,
        nodeType: 'ElementaryTypeName',
      },
    });
    const input: SolidityJsonInput = {
      language: 'Solidity',
      sources: {
        'Compact.sol': {
          content:
            'contract C { function(uint8) internal constant returns (bytes4) cb; }',
        },
      },
      settings: {},
    };
    const output = {
      contracts: {},
      sources: {
        'Compact.sol': {
          id: 0,
          ast: {
            id: 500,
            nodeType: 'SourceUnit',
            nodes: [
              {
                id: 100,
                name: 'C',
                nodeType: 'ContractDefinition',
                linearizedBaseContracts: [100],
                nodes: [
                  {
                    constant: false,
                    id: 1,
                    name: 'cb',
                    nodeType: 'VariableDeclaration',
                    typeDescriptions: {
                      typeString: 'function (uint8) constant returns (bytes4)',
                    },
                    typeName: {
                      id: 2,
                      isDeclaredConst: true,
                      nodeType: 'FunctionTypeName',
                      parameterTypes: {
                        id: 3,
                        nodeType: 'ParameterList',
                        parameters: [parameter(4, 'uint8')],
                      },
                      returnParameterTypes: {
                        id: 5,
                        nodeType: 'ParameterList',
                        parameters: [parameter(6, 'bytes4')],
                      },
                      typeDescriptions: {
                        typeString:
                          'function (uint8) constant returns (bytes4)',
                      },
                      visibility: 'internal',
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    } as unknown as SolidityOutput;

    const layout = generateHistoricalSolidityStorageLayout(
      '0.4.12+commit.194ff033',
      input,
      output,
      { path: 'Compact.sol', name: 'C' },
    );

    expect(layout?.storage[0].type).to.equal(
      't_function_internal_view(t_uint8)returns(t_bytes4)',
    );
  });

  it('uses the historical fixed-point width rule before 0.4.14', () => {
    const input: SolidityJsonInput = {
      language: 'Solidity',
      sources: {
        'Fixed.sol': { content: 'contract C { fixed128x128 a; uint8 b; }' },
      },
      settings: {},
    };
    const output = legacyContractOutput('Fixed.sol', 'C', [
      legacyElementaryVariable(1, 'a', 'fixed128x128'),
      legacyElementaryVariable(2, 'b', 'uint8'),
    ]);
    const oldLayout = generateHistoricalSolidityStorageLayout(
      '0.4.13+commit.0fb4cb1a',
      input,
      output,
      { path: 'Fixed.sol', name: 'C' },
    );

    expect(
      oldLayout?.storage.map(({ slot, offset }) => ({ slot, offset })),
    ).to.deep.equal([
      { slot: '0', offset: 0 },
      { slot: '1', offset: 0 },
    ]);
  });

  it('switches fixed-point storage widths at the historical nightly cutoff', () => {
    const input: SolidityJsonInput = {
      language: 'Solidity',
      sources: {
        'Fixed.sol': { content: 'contract C { fixed128x16 a; uint8 b; }' },
      },
      settings: {},
    };
    const output = legacyContractOutput('Fixed.sol', 'C', [
      legacyElementaryVariable(1, 'a', 'fixed128x16'),
      legacyElementaryVariable(2, 'b', 'uint8'),
    ]);
    const offsets = (version: string) =>
      generateHistoricalSolidityStorageLayout(version, input, output, {
        path: 'Fixed.sol',
        name: 'C',
      })?.storage.map(({ offset }) => offset);

    expect(offsets('0.4.14-nightly.2017.7.19+commit.aaaa')).to.deep.equal([
      0, 18,
    ]);
    expect(offsets('0.4.14-nightly.2017.7.20+commit.bbbb')).to.deep.equal([
      0, 16,
    ]);
    expect(offsets('0.4.14-ci.2017.7.19+commit.cccc')).to.deep.equal([0, 18]);
    expect(offsets('0.4.14-ci.2017.7.20+commit.dddd')).to.deep.equal([0, 16]);
  });

  it('returns the native null type table for an empty contract', () => {
    const input: SolidityJsonInput = {
      language: 'Solidity',
      sources: { 'Empty.sol': { content: 'contract Empty {}' } },
      settings: {},
    };
    const output = legacyContractOutput('Empty.sol', 'Empty', []);

    expect(
      generateHistoricalSolidityStorageLayout(
        '0.4.11+commit.68ef5810',
        input,
        output,
        { path: 'Empty.sol', name: 'Empty' },
      ),
    ).to.deep.equal({ storage: [], types: null });
  });

  it('fails closed when a user-defined type cannot be resolved', () => {
    const input: SolidityJsonInput = {
      language: 'Solidity',
      sources: { 'Broken.sol': { content: 'contract C { Missing value; }' } },
      settings: {},
    };
    const output = legacyContractOutput('Broken.sol', 'C', [
      {
        id: 1,
        name: 'VariableDeclaration',
        attributes: {
          constant: false,
          name: 'value',
          type: 'struct Missing storage ref',
        },
        children: [
          {
            id: 2,
            name: 'UserDefinedTypeName',
            attributes: { name: 'Missing' },
          },
        ],
      },
    ]);

    expect(() =>
      generateHistoricalSolidityStorageLayout(
        '0.4.11+commit.68ef5810',
        input,
        output,
        { path: 'Broken.sol', name: 'C' },
      ),
    ).to.throw('Cannot resolve user-defined type Missing');
  });
});

function legacyElementaryVariable(id: number, name: string, type: string) {
  return {
    id,
    name: 'VariableDeclaration',
    attributes: { constant: false, name, type },
    children: [
      {
        id: id + 1000,
        name: 'ElementaryTypeName',
        attributes: { name: type },
      },
    ],
  };
}

function legacyFunctionVariable(
  id: number,
  name: string,
  visibility: 'external' | 'internal',
  constant: boolean,
  parameters: string[],
  returns: string[],
) {
  let nextId = id + 2;
  const parameterList = (types: string[]) => ({
    id: nextId++,
    name: 'ParameterList',
    children: types.map((type) => {
      const typeId = nextId++;
      return {
        id: nextId++,
        name: 'VariableDeclaration',
        attributes: { constant: false, name: '', type },
        children: [
          {
            id: typeId,
            name: 'ElementaryTypeName',
            attributes: { name: type },
          },
        ],
      };
    }),
  });
  const parameterTypes = parameterList(parameters);
  const returnParameterTypes = parameterList(returns);
  const mutability = constant ? ' constant' : '';
  const returnLabel = returns.length ? ` returns (${returns.join(',')})` : '';
  return {
    id,
    name: 'VariableDeclaration',
    attributes: {
      constant: false,
      name,
      type: `function (${parameters.join(',')}) ${visibility}${mutability}${returnLabel}`,
    },
    children: [
      {
        id: id + 1,
        name: 'FunctionTypeName',
        attributes: { constant, payable: false, visibility },
        children: [parameterTypes, returnParameterTypes],
      },
    ],
  };
}

function legacyContractOutput(
  path: string,
  name: string,
  variables: Record<string, unknown>[],
): SolidityOutput {
  return {
    contracts: {},
    sources: {
      [path]: {
        id: 0,
        legacyAST: {
          id: 500,
          name: 'SourceUnit',
          children: [
            {
              id: 100,
              name: 'ContractDefinition',
              attributes: { name, linearizedBaseContracts: [100] },
              children: variables,
            },
          ],
        },
      },
    },
  } as unknown as SolidityOutput;
}
