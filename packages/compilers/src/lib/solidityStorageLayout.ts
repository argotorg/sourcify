import semver from 'semver';
import type {
  SolidityJsonInput,
  SolidityOutput,
  StorageLayout,
  StorageLayoutItem,
  StorageLayoutType,
} from '@ethereum-sourcify/compilers-types';

const MINIMUM_VERSION = '0.4.0';
const NATIVE_STORAGE_LAYOUT_VERSION = '0.5.13';
const FIXED_POINT_WIDTH_CHANGE_VERSION = '0.4.14-nightly.2017.7.20';
const WORD_BYTES = toBigInt(32);
const ZERO = toBigInt(0);
const ONE = toBigInt(1);

type JsonObject = Record<string, any>;

interface CompilationTarget {
  path: string;
  name: string;
}

interface StoragePosition {
  slot: bigint;
  offset: number;
}

interface HistoricalType {
  key: string;
  label: string;
  kind:
    'value' | 'bytes' | 'dynamic_array' | 'fixed_array' | 'mapping' | 'struct';
  astId: number;
  storageBytes: bigint;
  base?: HistoricalType;
  keyType?: HistoricalType;
  valueType?: HistoricalType;
  length?: bigint;
  definition?: JsonObject;
  contextContractId?: number;
}

interface TypeDefinition {
  node: JsonObject;
  kind: 'ContractDefinition' | 'EnumDefinition' | 'StructDefinition';
  name: string;
  contractId?: number;
}

function normalizeCompilerVersion(version: string): string {
  return version.trim().replace(/^v/, '').replace('-ci.', '-nightly.');
}

/**
 * Returns true for the standalone historical reconstruction range. Persisting
 * layouts before 0.4.7 requires additional source-identity safeguards.
 */
export function supportsHistoricalSolidityStorageLayout(
  version: string,
): boolean {
  const normalized = semver.valid(normalizeCompilerVersion(version));
  return Boolean(
    normalized &&
    semver.gte(normalized, `${MINIMUM_VERSION}-0`) &&
    semver.lt(normalized, NATIVE_STORAGE_LAYOUT_VERSION),
  );
}

/**
 * Reconstructs solc's storageLayout artifact from the analyzed historical AST.
 *
 * The implementation mirrors the storage allocation routines present in solc
 * 0.4.x and 0.5.x. It intentionally throws on unresolved AST constructs so a
 * caller can fail closed instead of persisting a partial layout.
 */
export function generateHistoricalSolidityStorageLayout(
  version: string,
  input: SolidityJsonInput,
  output: SolidityOutput,
  target: CompilationTarget,
): StorageLayout | undefined {
  if (!supportsHistoricalSolidityStorageLayout(version)) return undefined;

  return new HistoricalStorageLayoutBuilder(
    normalizeCompilerVersion(version),
    input,
    output,
    target,
  ).generate();
}

class HistoricalStorageLayoutBuilder {
  private readonly nodePaths = new Map<JsonObject, string>();
  private readonly nodeContracts = new Map<JsonObject, number>();
  private readonly definitions: TypeDefinition[] = [];
  private readonly definitionsById = new Map<number, TypeDefinition>();
  private readonly contractsById = new Map<number, JsonObject>();
  private readonly types = new Map<string, HistoricalType>();
  private readonly generatedTypes: Record<string, StorageLayoutType> = {};
  private readonly fullyQualifiedName: string;

  constructor(
    private readonly version: string,
    private readonly input: SolidityJsonInput,
    private readonly output: SolidityOutput,
    private readonly target: CompilationTarget,
  ) {
    this.fullyQualifiedName = `${target.path}:${target.name}`;
    this.indexAsts();
  }

  generate(): StorageLayout {
    const contract = this.findTargetContract();
    const linearizedBaseContracts = this.linearizedBaseContracts(contract);
    const variables: JsonObject[] = [];

    for (const contractId of [...linearizedBaseContracts].reverse()) {
      const base = this.contractsById.get(contractId);
      if (!base) {
        throw new Error(
          `Cannot resolve linearized base contract AST id ${contractId}`,
        );
      }
      for (const variable of directChildren(base).filter(
        (node) => nodeKind(node) === 'VariableDeclaration',
      )) {
        if (!this.isConstant(variable)) variables.push(variable);
      }
    }

    const variableTypes = variables.map((variable) =>
      this.typeFromVariable(variable),
    );
    const { positions } = this.computeOffsets(variableTypes);
    const storage = variables.map((variable, index) => {
      const type = variableTypes[index];
      const position = positions[index];
      this.generateType(type);
      return this.storageItem(variable, type, position);
    });

    return {
      storage,
      types: storage.length === 0 ? null : this.generatedTypes,
    };
  }

  private indexAsts() {
    if (!this.output.sources) {
      throw new Error('Historical compiler output does not contain sources');
    }

    for (const [path, source] of Object.entries(this.output.sources)) {
      const ast = source.ast ?? source.legacyAST;
      if (!ast) continue;
      this.visit(ast, path, undefined);
    }
  }

  private visit(node: unknown, path: string, contractId?: number) {
    if (!isObject(node)) return;

    const kind = nodeKind(node);
    let currentContractId = contractId;
    if (kind === 'ContractDefinition') {
      currentContractId = requiredNodeId(node);
      this.contractsById.set(currentContractId, node);
    }

    if (typeof node.id === 'number' || typeof node.id === 'string') {
      this.nodePaths.set(node, path);
      if (currentContractId !== undefined) {
        this.nodeContracts.set(node, currentContractId);
      }
    }

    if (
      kind === 'ContractDefinition' ||
      kind === 'EnumDefinition' ||
      kind === 'StructDefinition'
    ) {
      const definition: TypeDefinition = {
        node,
        kind,
        name: requiredNodeName(node),
        ...(kind !== 'ContractDefinition' && currentContractId !== undefined
          ? { contractId: currentContractId }
          : {}),
      };
      this.definitions.push(definition);
      this.definitionsById.set(requiredNodeId(node), definition);
    }

    for (const child of astChildren(node)) {
      this.visit(child, path, currentContractId);
    }
  }

  private findTargetContract(): JsonObject {
    const candidates = [...this.contractsById.values()].filter(
      (contract) => requiredNodeName(contract) === this.target.name,
    );
    const exact = candidates.find(
      (contract) => this.nodePaths.get(contract) === this.target.path,
    );
    if (exact) return exact;
    throw new Error(
      `Cannot resolve compilation target ${this.fullyQualifiedName}`,
    );
  }

  private linearizedBaseContracts(contract: JsonObject): number[] {
    const value =
      contract.linearizedBaseContracts ??
      contract.attributes?.linearizedBaseContracts;
    if (!Array.isArray(value)) {
      throw new Error(
        `Contract ${requiredNodeName(contract)} has no linearized base contracts`,
      );
    }
    return value.map(requiredInteger);
  }

  private isConstant(variable: JsonObject): boolean {
    const constant = variable.constant ?? variable.attributes?.constant;
    if (typeof constant === 'boolean') return constant;

    const path = this.nodePaths.get(variable);
    const src = parseSrc(variable.src);
    const source = path ? this.input.sources[path]?.content : undefined;
    if (!source || !src) {
      throw new Error(
        `Cannot determine whether ${requiredNodeName(variable)} is constant`,
      );
    }
    const declaration = sliceUtf8Bytes(source, src.start, src.length);
    return /\bconstant\b/.test(stripCommentsAndStrings(declaration));
  }

  private typeFromVariable(variable: JsonObject): HistoricalType {
    const typeName =
      variable.typeName ??
      directChildren(variable).find((child) => isTypeName(child));
    if (!typeName) {
      throw new Error(
        `Variable ${requiredNodeName(variable)} has no type-name AST`,
      );
    }
    const contextContractId = this.nodeContracts.get(variable);
    return this.typeFromNode(
      typeName,
      contextContractId,
      resolvedTypeString(variable),
    );
  }

  private typeFromNode(
    node: JsonObject,
    contextContractId?: number,
    resolvedType?: string,
  ): HistoricalType {
    const kind = nodeKind(node);

    if (kind === 'ElementaryTypeName') {
      return this.elementaryType(
        node,
        resolvedTypeString(node) ?? resolvedType,
      );
    }
    if (kind === 'ArrayTypeName') {
      const children = directChildren(node);
      const baseNode =
        node.baseType ?? children.find((child) => isTypeName(child));
      if (!baseNode) throw new Error('Array type has no base type');
      const arraySemanticType = resolvedTypeString(node) ?? resolvedType;
      const semanticArray = arraySemanticType
        ? peelArrayDimension(arraySemanticType)
        : undefined;
      const base = this.typeFromNode(
        baseNode,
        contextContractId,
        semanticArray?.base,
      );
      const lengthNode =
        node.length ??
        children.find((child) => child !== baseNode && isObject(child));
      if (lengthNode === null || lengthNode === undefined) {
        return this.intern({
          key: `t_array(${base.key})dyn_storage`,
          label: `${base.label}[]`,
          kind: 'dynamic_array',
          astId: requiredNodeId(node),
          storageBytes: WORD_BYTES,
          base,
          contextContractId,
        });
      }
      const length = constantInteger(lengthNode, semanticArray?.length);
      return this.intern({
        key: `t_array(${base.key})${length.toString()}_storage`,
        label: `${base.label}[${length.toString()}]`,
        kind: 'fixed_array',
        astId: requiredNodeId(node),
        storageBytes: WORD_BYTES,
        base,
        length,
        contextContractId,
      });
    }
    if (kind === 'Mapping') {
      const children = directChildren(node).filter(isTypeName);
      const keyNode = node.keyType ?? children[0];
      const valueNode = node.valueType ?? children[1];
      if (!keyNode || !valueNode) throw new Error('Mapping type is incomplete');
      const semanticMapping = splitMappingType(
        resolvedTypeString(node) ?? resolvedType,
      );
      const keyType = this.typeFromNode(
        keyNode,
        contextContractId,
        semanticMapping?.key,
      );
      const valueType = this.typeFromNode(
        valueNode,
        contextContractId,
        semanticMapping?.value,
      );
      return this.intern({
        key: `t_mapping(${keyType.key},${valueType.key})`,
        label: `mapping(${keyType.label} => ${valueType.label})`,
        kind: 'mapping',
        astId: requiredNodeId(node),
        storageBytes: WORD_BYTES,
        keyType,
        valueType,
        contextContractId,
      });
    }
    if (kind === 'UserDefinedTypeName') {
      return this.userDefinedType(
        node,
        contextContractId,
        resolvedTypeString(node) ?? resolvedType,
      );
    }
    if (kind === 'FunctionTypeName') {
      const visibility = node.visibility ?? node.attributes?.visibility;
      const external = visibility === 'external';
      const semanticType = resolvedTypeString(node) ?? resolvedType;
      return this.intern({
        key: this.functionTypeIdentifier(node, external),
        label: semanticType ?? `function ${external ? 'external' : 'internal'}`,
        kind: 'value',
        astId: requiredNodeId(node),
        storageBytes: toBigInt(external ? 24 : 8),
        contextContractId,
      });
    }

    throw new Error(`Unsupported historical Solidity type AST ${kind}`);
  }

  private functionTypeIdentifier(node: JsonObject, external: boolean): string {
    const parameterLists = directChildren(node).filter(
      (child) => nodeKind(child) === 'ParameterList',
    );
    const parameters = node.parameterTypes ?? parameterLists[0];
    const returns = node.returnParameterTypes ?? parameterLists[1];
    if (!parameters || !returns) {
      throw new Error('Legacy function type has incomplete parameter lists');
    }

    const parameterTypes = parameterListVariables(parameters).map((parameter) =>
      this.functionParameterTypeIdentifier(parameter),
    );
    const returnTypes = parameterListVariables(returns).map((parameter) =>
      this.functionParameterTypeIdentifier(parameter),
    );
    const rawMutability =
      node.stateMutability ?? node.attributes?.stateMutability;
    const mutability =
      rawMutability === 'pure' ||
      rawMutability === 'view' ||
      rawMutability === 'payable'
        ? rawMutability
        : node.payable === true || node.attributes?.payable === true
          ? 'payable'
          : node.constant === true ||
              node.attributes?.constant === true ||
              node.isDeclaredConst === true ||
              node.attributes?.isDeclaredConst === true
            ? 'view'
            : 'nonpayable';

    return `t_function_${external ? 'external' : 'internal'}_${mutability}(${parameterTypes.join(',')})returns(${returnTypes.join(',')})`;
  }

  private functionParameterTypeIdentifier(parameter: JsonObject): string {
    const type = this.typeFromVariable(parameter);
    const semanticType = resolvedTypeString(parameter);
    const astLocation =
      parameter.storageLocation ?? parameter.attributes?.storageLocation;
    const location =
      astLocation === 'storage' ||
      astLocation === 'memory' ||
      astLocation === 'calldata'
        ? astLocation
        : semanticType?.match(/\b(storage|memory|calldata)\b/)?.[1];
    if (location && type.kind !== 'mapping') {
      return this.typeIdentifierAtLocation(type, location);
    }
    return type.key;
  }

  private typeIdentifierAtLocation(
    type: HistoricalType,
    location: string,
  ): string {
    if (type.kind === 'dynamic_array' || type.kind === 'fixed_array') {
      if (!type.base) throw new Error(`Array ${type.label} has no base type`);
      const base = this.typeIdentifierAtLocation(type.base, location);
      const length =
        type.kind === 'dynamic_array'
          ? 'dyn'
          : requiredBigInt(type.length, `Array ${type.label} has no length`);
      return `t_array(${base})${length}_${location}_ptr`;
    }
    if (type.kind === 'bytes' || type.kind === 'struct') {
      if (!type.key.endsWith('_storage')) {
        throw new Error(`Reference type ${type.label} has no storage suffix`);
      }
      return `${type.key.slice(0, -'_storage'.length)}_${location}_ptr`;
    }
    return type.key;
  }

  private elementaryType(
    node: JsonObject,
    resolvedType?: string,
  ): HistoricalType {
    let name = String(
      (node.nodeType ? node.name : node.attributes?.name) ?? resolvedType ?? '',
    );
    if (
      resolvedType &&
      (name === 'var' || name === 'fixed' || name === 'ufixed')
    ) {
      name = resolvedType;
    }
    name = name.replace(/\s+(storage|memory|calldata)(\s+(ref|pointer))?$/, '');
    name = name.replace(/\s+payable$/, '');

    if (name === 'uint') name = 'uint256';
    if (name === 'int') name = 'int256';
    if (name === 'byte') name = 'bytes1';
    if (name === 'address') {
      const payable = /\baddress payable\b/.test(resolvedType ?? '');
      return this.valueType(
        payable ? 't_address_payable' : 't_address',
        payable ? 'address payable' : 'address',
        20,
        node,
      );
    }
    if (name === 'bool') return this.valueType('t_bool', 'bool', 1, node);
    if (name === 'bytes' || name === 'string') {
      return this.intern({
        key: `t_${name}_storage`,
        label: name,
        kind: 'bytes',
        astId: requiredNodeId(node),
        storageBytes: WORD_BYTES,
      });
    }

    const integer = /^(u?int)(\d+)$/.exec(name);
    if (integer) {
      return this.valueType(`t_${name}`, name, Number(integer[2]) / 8, node);
    }
    const fixedBytes = /^bytes(\d+)$/.exec(name);
    if (fixedBytes) {
      return this.valueType(`t_${name}`, name, Number(fixedBytes[1]), node);
    }
    if (name === 'fixed' || name === 'ufixed') {
      const decimals = semver.lt(this.version, FIXED_POINT_WIDTH_CHANGE_VERSION)
        ? 128
        : semver.lt(this.version, '0.4.22')
          ? 19
          : 18;
      name = `${name}128x${decimals}`;
    }
    const fixedPoint = /^(u?fixed)(\d+)(?:x(\d+))?$/.exec(name);
    if (fixedPoint) {
      const bits = semver.lt(this.version, FIXED_POINT_WIDTH_CHANGE_VERSION)
        ? Number(fixedPoint[2]) + Number(fixedPoint[3] ?? 0)
        : Number(fixedPoint[2]);
      return this.valueType(`t_${name}`, name, bits / 8, node);
    }

    throw new Error(`Unsupported elementary storage type ${name}`);
  }

  private valueType(
    key: string,
    label: string,
    bytes: number,
    node: JsonObject,
  ): HistoricalType {
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > 32) {
      throw new Error(`Invalid storage width ${bytes} for ${label}`);
    }
    return this.intern({
      key,
      label,
      kind: 'value',
      astId: requiredNodeId(node),
      storageBytes: toBigInt(bytes),
    });
  }

  private userDefinedType(
    node: JsonObject,
    contextContractId?: number,
    resolvedType?: string,
  ): HistoricalType {
    const referencedDeclaration =
      node.referencedDeclaration ?? node.attributes?.referencedDeclaration;
    let definition =
      referencedDeclaration !== undefined
        ? this.definitionsById.get(requiredInteger(referencedDeclaration))
        : undefined;
    if (!definition) {
      definition = this.resolveLegacyDefinition(
        requiredNodeName(node),
        contextContractId,
        resolvedType,
      );
    }
    if (!definition) {
      throw new Error(
        `Cannot resolve user-defined type ${requiredNodeName(node)}`,
      );
    }

    const id = requiredNodeId(definition.node);
    if (definition.kind === 'ContractDefinition') {
      const contractKind =
        definition.node.contractKind === 'library' ||
        definition.node.attributes?.contractKind === 'library' ||
        definition.node.attributes?.isLibrary === true
          ? 'library'
          : 'contract';
      return this.intern({
        key: `t_contract(${definition.name})${id}`,
        label: `${contractKind} ${definition.name}`,
        kind: 'value',
        astId: id,
        storageBytes: toBigInt(20),
        definition: definition.node,
        contextContractId,
      });
    }

    const owner =
      definition.contractId !== undefined
        ? this.contractsById.get(definition.contractId)
        : undefined;
    const canonicalName = owner
      ? `${requiredNodeName(owner)}.${definition.name}`
      : definition.name;
    if (definition.kind === 'EnumDefinition') {
      const memberCount = directChildren(definition.node).filter(
        (child) => nodeKind(child) === 'EnumValue',
      ).length;
      const bytes = bytesRequired(Math.max(0, memberCount - 1));
      return this.intern({
        key: `t_enum(${definition.name})${id}`,
        label: `enum ${canonicalName}`,
        kind: 'value',
        astId: id,
        storageBytes: toBigInt(Math.max(1, bytes)),
        definition: definition.node,
        contextContractId: definition.contractId,
      });
    }

    return this.intern({
      key: `t_struct(${definition.name})${id}_storage`,
      label: `struct ${canonicalName}`,
      kind: 'struct',
      astId: id,
      storageBytes: WORD_BYTES,
      definition: definition.node,
      contextContractId: definition.contractId,
    });
  }

  private resolveLegacyDefinition(
    rawName: string,
    contextContractId?: number,
    resolvedType?: string,
  ): TypeDefinition | undefined {
    const hint = resolvedType?.trim().split(/\s+/)[0];
    const expectedKind =
      hint === 'struct'
        ? 'StructDefinition'
        : hint === 'enum'
          ? 'EnumDefinition'
          : hint === 'contract' || hint === 'library'
            ? 'ContractDefinition'
            : undefined;
    const qualified = (resolvedType ?? rawName)
      .replace(/^(struct|enum|contract|library)\s+/, '')
      .replace(/\s+(storage|memory|calldata).*$/, '');
    const parts = qualified.split('.');
    const name = parts[parts.length - 1];
    let candidates = this.definitions.filter(
      (definition) =>
        definition.name === name &&
        (!expectedKind || definition.kind === expectedKind),
    );

    const ownerName = parts.length > 1 ? parts[parts.length - 2] : undefined;
    if (ownerName) {
      candidates = candidates.filter((definition) => {
        if (definition.contractId === undefined) return false;
        const owner = this.contractsById.get(definition.contractId);
        return owner && requiredNodeName(owner) === ownerName;
      });
    } else if (contextContractId !== undefined) {
      const context = this.contractsById.get(contextContractId);
      const scope = context ? this.linearizedBaseContracts(context) : [];
      for (const contractId of scope) {
        const scoped = candidates.find(
          (definition) => definition.contractId === contractId,
        );
        if (scoped) return scoped;
      }
    }

    return candidates.length === 1 ? candidates[0] : undefined;
  }

  private storageSize(
    type: HistoricalType,
    visiting = new Set<string>(),
  ): bigint {
    if (
      type.kind === 'value' ||
      type.kind === 'bytes' ||
      type.kind === 'dynamic_array' ||
      type.kind === 'mapping'
    ) {
      return ONE;
    }
    if (type.kind === 'fixed_array') {
      if (!type.base || type.length === undefined) {
        throw new Error(`Incomplete fixed-array type ${type.key}`);
      }
      const baseBytes = type.base.storageBytes;
      let size: bigint;
      if (baseBytes < WORD_BYTES) {
        const itemsPerSlot = WORD_BYTES / baseBytes;
        size = ceilDiv(type.length, itemsPerSlot);
      } else {
        size = type.length * this.storageSize(type.base, visiting);
      }
      return size > ZERO ? size : ONE;
    }
    if (!type.definition) throw new Error(`Incomplete struct type ${type.key}`);
    if (visiting.has(type.key)) {
      throw new Error(`Illegal direct recursive struct ${type.label}`);
    }
    const nextVisiting = new Set(visiting).add(type.key);
    const members = this.structMembers(type);
    return this.computeOffsets(
      members.map((member) => member.type),
      nextVisiting,
    ).size;
  }

  private computeOffsets(
    types: HistoricalType[],
    visiting = new Set<string>(),
  ): { positions: StoragePosition[]; size: bigint } {
    let slot = ZERO;
    let byteOffset = ZERO;
    const positions: StoragePosition[] = [];

    for (const type of types) {
      if (byteOffset + type.storageBytes > WORD_BYTES) {
        slot += ONE;
        byteOffset = ZERO;
      }
      positions.push({ slot, offset: Number(byteOffset) });
      const size = this.storageSize(type, visiting);
      if (size === ONE && byteOffset + type.storageBytes <= WORD_BYTES) {
        byteOffset += type.storageBytes;
      } else {
        slot += size;
        byteOffset = ZERO;
      }
    }
    if (byteOffset > ZERO) slot += ONE;
    return { positions, size: slot };
  }

  private structMembers(type: HistoricalType) {
    if (!type.definition) throw new Error(`Struct ${type.label} has no AST`);
    return directChildren(type.definition)
      .filter((node) => nodeKind(node) === 'VariableDeclaration')
      .map((node) => ({ node, type: this.typeFromVariable(node) }));
  }

  private generateType(type: HistoricalType) {
    if (this.generatedTypes[type.key]) return;

    const typeInfo: StorageLayoutType = {
      encoding:
        type.kind === 'mapping'
          ? 'mapping'
          : type.kind === 'dynamic_array'
            ? 'dynamic_array'
            : type.kind === 'bytes'
              ? 'bytes'
              : 'inplace',
      label: type.label,
      numberOfBytes: (type.storageBytes * this.storageSize(type)).toString(),
    };
    this.generatedTypes[type.key] = typeInfo;

    if (type.kind === 'fixed_array' || type.kind === 'dynamic_array') {
      if (!type.base) throw new Error(`Array ${type.label} has no base type`);
      typeInfo.base = type.base.key;
      this.generateType(type.base);
    } else if (type.kind === 'mapping') {
      if (!type.keyType || !type.valueType) {
        throw new Error(`Mapping ${type.label} is incomplete`);
      }
      typeInfo.key = type.keyType.key;
      typeInfo.value = type.valueType.key;
      this.generateType(type.keyType);
      this.generateType(type.valueType);
    } else if (type.kind === 'struct') {
      const members = this.structMembers(type);
      const { positions } = this.computeOffsets(
        members.map((member) => member.type),
      );
      typeInfo.members = members.map((member, index) => {
        this.generateType(member.type);
        return this.storageItem(member.node, member.type, positions[index]);
      });
    }
  }

  private storageItem(
    node: JsonObject,
    type: HistoricalType,
    position: StoragePosition,
  ): StorageLayoutItem {
    return {
      astId: requiredNodeId(node),
      contract: this.fullyQualifiedName,
      label: requiredNodeName(node),
      offset: position.offset,
      slot: position.slot.toString(),
      type: type.key,
    };
  }

  private intern(type: HistoricalType): HistoricalType {
    const existing = this.types.get(type.key);
    if (existing) return existing;
    this.types.set(type.key, type);
    return type;
  }
}

function nodeKind(node: JsonObject): string {
  return String(node.nodeType ?? node.name ?? '');
}

function requiredNodeName(node: JsonObject): string {
  const name = node.nodeType ? node.name : node.attributes?.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`AST ${nodeKind(node)} node has no name`);
  }
  return name;
}

function requiredNodeId(node: JsonObject): number {
  return requiredInteger(node.id);
}

function requiredInteger(value: unknown): number {
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isInteger(number)) {
    throw new Error(`Expected an integer, got ${String(value)}`);
  }
  return number;
}

function requiredBigInt(value: bigint | undefined, message: string): bigint {
  if (value === undefined) throw new Error(message);
  return value;
}

function directChildren(node: JsonObject): JsonObject[] {
  if (Array.isArray(node.nodes)) return node.nodes.filter(isObject);
  if (Array.isArray(node.members)) return node.members.filter(isObject);
  if (Array.isArray(node.parameters)) return node.parameters.filter(isObject);
  if (Array.isArray(node.children)) return node.children.filter(isObject);
  return [];
}

function parameterListVariables(node: JsonObject): JsonObject[] {
  return directChildren(node).filter(
    (child) => nodeKind(child) === 'VariableDeclaration',
  );
}

function astChildren(node: JsonObject): JsonObject[] {
  const children: JsonObject[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'attributes' || key === 'typeDescriptions') continue;
    if (Array.isArray(value)) children.push(...value.filter(isAstNode));
    else if (isAstNode(value)) children.push(value);
  }
  return children;
}

function isAstNode(value: unknown): value is JsonObject {
  return (
    isObject(value) &&
    (typeof value.nodeType === 'string' ||
      (typeof value.name === 'string' && value.id !== undefined))
  );
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTypeName(node: JsonObject): boolean {
  return [
    'ArrayTypeName',
    'ElementaryTypeName',
    'FunctionTypeName',
    'Mapping',
    'UserDefinedTypeName',
  ].includes(nodeKind(node));
}

function resolvedTypeString(node: JsonObject): string | undefined {
  const value = node.typeDescriptions?.typeString ?? node.attributes?.type;
  return typeof value === 'string' ? value : undefined;
}

function constantInteger(node: JsonObject, fallback?: string): bigint {
  const candidates = [
    node.value,
    node.attributes?.value,
    node.typeDescriptions?.typeString,
    node.attributes?.type,
    fallback,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' && typeof candidate !== 'number') {
      continue;
    }
    const match = String(candidate).match(/^(?:int_const\s+)?(\d+)$/);
    if (match) return toBigInt(match[1]);
  }
  throw new Error('Cannot resolve fixed-array length from historical AST');
}

function peelArrayDimension(
  type: string,
): { base: string; length: string } | undefined {
  const normalized = type
    .trim()
    .replace(/\s+(storage|memory|calldata)\s+(ref|pointer)$/, '');
  const match =
    /^(.*)\[(\d*)\](?:\s+(storage|memory|calldata)\s+(ref|pointer))?$/.exec(
      normalized,
    );
  if (!match) return undefined;
  return { base: match[1].trim(), length: match[2] };
}

function splitMappingType(
  type: string | undefined,
): { key: string; value: string } | undefined {
  if (!type) return undefined;
  const normalized = type
    .trim()
    .replace(/\s+(storage|memory|calldata)(\s+(ref|pointer))?$/, '');
  if (!normalized.startsWith('mapping(') || !normalized.endsWith(')')) {
    return undefined;
  }
  const contents = normalized.slice('mapping('.length, -1);
  let depth = 0;
  for (let index = 0; index < contents.length - 1; index += 1) {
    const character = contents[index];
    if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth -= 1;
    else if (depth === 0 && character === '=' && contents[index + 1] === '>') {
      return {
        key: contents.slice(0, index).trim(),
        value: contents.slice(index + 2).trim(),
      };
    }
  }
  return undefined;
}

function bytesRequired(value: number): number {
  let remaining = value;
  let bytes = 0;
  do {
    bytes += 1;
    remaining = Math.floor(remaining / 256);
  } while (remaining > 0);
  return bytes;
}

function ceilDiv(value: bigint, divisor: bigint): bigint {
  return (value + divisor - ONE) / divisor;
}

function toBigInt(value: string | number): bigint {
  const bigint = (
    globalThis as unknown as {
      BigInt: (input: string | number) => bigint;
    }
  ).BigInt;
  return bigint(value);
}

function parseSrc(src: unknown): { start: number; length: number } | undefined {
  if (typeof src !== 'string') return undefined;
  const [start, length] = src.split(':').map(Number);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(length) ||
    start < 0 ||
    length < 0
  ) {
    return undefined;
  }
  return { start, length };
}

function sliceUtf8Bytes(source: string, start: number, length: number): string {
  const bytes = Buffer.from(source, 'utf8');
  if (start + length > bytes.length) {
    throw new Error('AST source range exceeds source contents');
  }
  return bytes.subarray(start, start + length).toString('utf8');
}

function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n\r]*/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' ');
}
