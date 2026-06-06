import { logWarn } from '../logger';
import { AbstractCompilation } from './AbstractCompilation';
import {
  AuxdataStyle,
  decode,
  splitAuxdata,
} from '@ethereum-sourcify/bytecode-utils';
import semver, { gte, gt, lt } from 'semver';
import type {
  VyperJsonInput,
  VyperOutput,
  VyperOutputContract,
  ImmutableReferences,
  LinkReferences,
} from '@ethereum-sourcify/compilers-types';
import type {
  CompilationLanguage,
  CompilationTarget,
  CompiledContractCborAuxdata,
  IVyperCompiler,
} from './CompilationTypes';
import { CompilationError } from './CompilationTypes';

export function returnFixedVyperVersion(compilerVersion: string): string {
  if (semver.valid(compilerVersion)) {
    return compilerVersion;
  } else {
    // Check for beta or release candidate versions
    if (compilerVersion.match(/\d+\.\d+\.\d+(b\d+|rc\d+)/)) {
      return `${compilerVersion.split('+')[0].replace(/(b\d+|rc\d+)$/, '')}+${
        compilerVersion.split('+')[1]
      }`;
    } else {
      throw new CompilationError({ code: 'invalid_compiler_version' });
    }
  }
}

// evm.bytecode.sourceMap is supported from 0.4.0rc4 onwards.
// compilerVersionCompatibleWithSemver strips the rc/b suffix, so all 0.4.0
// variants look the same to semver — we must inspect the raw version for that
// specific boundary.
export function supportsCreationBytecodeSourceMap(
  compilerVersion: string,
  compatibleVersion: string,
): boolean {
  if (gt(compatibleVersion, '0.4.0')) return true;
  if (lt(compatibleVersion, '0.4.0')) return false;
  // Exactly 0.4.0 — inspect the original version string
  if (/0\.4\.0b\d+/.test(compilerVersion)) return false;
  const rcMatch = compilerVersion.match(/0\.4\.0rc(\d+)/);
  if (rcMatch) return parseInt(rcMatch[1]) >= 4;
  return true; // stable 0.4.0
}

export function returnAuxdataStyle(
  compilerVersion: string,
):
  | AuxdataStyle.VYPER_LT_0_3_4
  | AuxdataStyle.VYPER_LT_0_3_5
  | AuxdataStyle.VYPER_LT_0_3_10
  | AuxdataStyle.VYPER {
  // Vyper versions < 0.3.4 emit no CBOR auxdata at all
  if (semver.lt(compilerVersion, '0.3.4')) {
    return AuxdataStyle.VYPER_LT_0_3_4;
  }
  // Only 0.3.4 uses the fixed-length 22-byte CBOR format
  if (semver.lt(compilerVersion, '0.3.5')) {
    return AuxdataStyle.VYPER_LT_0_3_5;
  }
  if (semver.lt(compilerVersion, '0.3.10')) {
    return AuxdataStyle.VYPER_LT_0_3_10;
  }
  return AuxdataStyle.VYPER;
}

type VyperAstNode = Record<string, any>;
type VyperStructDefinitions = Record<string, VyperAstNode[]>;
type VyperIntegerConstants = Record<string, number>;

const WORD_SIZE = 32;
const DYNAMIC_ARRAY_OVERHEAD_WORDS = 1;

function ceil32(value: number): number {
  return Math.ceil(value / WORD_SIZE) * WORD_SIZE;
}

function isAstNode(node: unknown): node is VyperAstNode {
  return node !== null && typeof node === 'object';
}

function getImmutableTypeAnnotation(
  node: VyperAstNode,
): VyperAstNode | undefined {
  const annotation = node.annotation;
  if (!isAstNode(annotation)) {
    return undefined;
  }

  const immutableCall =
    annotation.ast_type === 'Call' && annotation.func?.id === 'immutable';

  if (immutableCall && isAstNode(annotation.args?.[0])) {
    return annotation.args[0];
  }

  if (node.is_immutable === true) {
    return annotation;
  }

  return undefined;
}

function collectStructDefinitions(ast: VyperAstNode): VyperStructDefinitions {
  const structs: VyperStructDefinitions = {};
  for (const node of ast.body ?? []) {
    if (
      isAstNode(node) &&
      node.ast_type === 'StructDef' &&
      typeof node.name === 'string' &&
      Array.isArray(node.body)
    ) {
      structs[node.name] = node.body.filter(isAstNode);
    }
  }
  return structs;
}

function getAstIntegerValue(node: VyperAstNode): number | undefined {
  const value = node.value ?? node.n;
  if (Number.isSafeInteger(value)) {
    return value;
  }
  return undefined;
}

function evaluateIntegerExpression(
  node: unknown,
  constants: VyperIntegerConstants,
): number | undefined {
  if (!isAstNode(node)) {
    return undefined;
  }

  const integerValue = getAstIntegerValue(node);
  if (integerValue !== undefined) {
    return integerValue;
  }

  if (node.ast_type === 'Name' && typeof node.id === 'string') {
    return constants[node.id];
  }

  if (node.ast_type === 'UnaryOp') {
    const operand = evaluateIntegerExpression(node.operand, constants);
    if (operand === undefined) {
      return undefined;
    }
    if (node.op?.ast_type === 'USub') {
      return -operand;
    }
    if (node.op?.ast_type === 'UAdd') {
      return operand;
    }
    return undefined;
  }

  if (node.ast_type !== 'BinOp') {
    return undefined;
  }

  const left = evaluateIntegerExpression(node.left, constants);
  const right = evaluateIntegerExpression(node.right, constants);
  if (left === undefined || right === undefined) {
    return undefined;
  }

  let result: number | undefined;
  switch (node.op?.ast_type) {
    case 'Add':
      result = left + right;
      break;
    case 'Sub':
      result = left - right;
      break;
    case 'Mult':
      result = left * right;
      break;
    case 'Pow':
      result = left ** right;
      break;
    case 'Div':
    case 'FloorDiv':
      if (right === 0 || left % right !== 0) {
        return undefined;
      }
      result = left / right;
      break;
    default:
      return undefined;
  }

  if (Number.isSafeInteger(result)) {
    return result;
  }
  return undefined;
}

function getConstantTypeAnnotation(
  node: VyperAstNode,
): VyperAstNode | undefined {
  const annotation = node.annotation;
  if (!isAstNode(annotation)) {
    return undefined;
  }

  if (node.is_constant === true) {
    return annotation;
  }

  const constantCall =
    annotation.ast_type === 'Call' && annotation.func?.id === 'constant';
  if (constantCall && isAstNode(annotation.args?.[0])) {
    return annotation.args[0];
  }

  return undefined;
}

function collectIntegerConstantDefinitions(
  ast: VyperAstNode,
): VyperIntegerConstants {
  const constants: VyperIntegerConstants = {};
  let pendingConstants: VyperAstNode[] = ast.body
    .filter(isAstNode)
    .filter(
      (node: VyperAstNode) =>
        typeof node.target?.id === 'string' &&
        getConstantTypeAnnotation(node) !== undefined &&
        isAstNode(node.value),
    );

  while (pendingConstants.length > 0) {
    const remainingConstants: VyperAstNode[] = [];
    let madeProgress = false;

    for (const node of pendingConstants) {
      const value = evaluateIntegerExpression(node.value, constants);
      if (value === undefined) {
        remainingConstants.push(node);
        continue;
      }

      constants[node.target.id] = value;
      madeProgress = true;
    }

    if (!madeProgress) {
      break;
    }
    pendingConstants = remainingConstants;
  }

  return constants;
}

function getSubscriptLength(
  node: VyperAstNode,
  constants: VyperIntegerConstants,
): number | undefined {
  const value = node.slice?.value;
  if (typeof value?.value === 'number') {
    return value.value;
  }
  if (typeof value?.n === 'number') {
    return value.n;
  }
  return evaluateIntegerExpression(value, constants);
}

function getTypeByteLength(
  annotation: VyperAstNode,
  structs: VyperStructDefinitions,
  constants: VyperIntegerConstants,
): number | undefined {
  if (annotation.ast_type === 'Name' && typeof annotation.id === 'string') {
    const structMembers = structs[annotation.id];
    if (structMembers !== undefined) {
      let structByteLength = 0;
      for (const member of structMembers) {
        const memberByteLength = getTypeByteLength(
          member.annotation,
          structs,
          constants,
        );
        if (memberByteLength === undefined) {
          return undefined;
        }
        structByteLength += memberByteLength;
      }
      return structByteLength;
    }

    // Base types, enums, and interface types occupy one word in Vyper's
    // legacy immutable section.
    return WORD_SIZE;
  }

  if (annotation.ast_type !== 'Subscript' || !isAstNode(annotation.value)) {
    return undefined;
  }

  const typeName = annotation.value.id;
  if (typeName === 'DynArray') {
    const elements = annotation.slice?.value?.elements;
    const subtype = elements?.[0];
    const maxLength = evaluateIntegerExpression(elements?.[1], constants);
    if (!isAstNode(subtype) || typeof maxLength !== 'number') {
      return undefined;
    }

    const subtypeByteLength = getTypeByteLength(subtype, structs, constants);
    if (subtypeByteLength === undefined) {
      return undefined;
    }
    return (
      DYNAMIC_ARRAY_OVERHEAD_WORDS * WORD_SIZE + maxLength * subtypeByteLength
    );
  }

  const length = getSubscriptLength(annotation, constants);
  if (length === undefined) {
    return undefined;
  }

  if (typeName === 'Bytes' || typeName === 'String') {
    return ceil32(length) + DYNAMIC_ARRAY_OVERHEAD_WORDS * WORD_SIZE;
  }

  const subtypeByteLength = getTypeByteLength(
    annotation.value,
    structs,
    constants,
  );
  if (subtypeByteLength === undefined) {
    return undefined;
  }
  return length * subtypeByteLength;
}

export function returnLegacyVyperImmutableReferences(
  compilerOutput: VyperOutput | undefined,
  compilationTargetPath: string,
  runtimeBytecode: string,
): ImmutableReferences {
  if (!compilerOutput?.sources) {
    return {};
  }

  const ast = compilerOutput.sources[compilationTargetPath]?.ast;
  if (!isAstNode(ast) || !Array.isArray(ast.body)) {
    return {};
  }

  const structs = collectStructDefinitions(ast);
  const constants = collectIntegerConstantDefinitions(ast);
  const runtimeByteLength = runtimeBytecode.substring(2).length / 2;
  let immutableOffset = 0;

  for (const node of ast.body.filter(isAstNode)) {
    const annotation = getImmutableTypeAnnotation(node);
    if (annotation === undefined) {
      continue;
    }

    const immutableByteLength = getTypeByteLength(
      annotation,
      structs,
      constants,
    );
    if (
      immutableByteLength === undefined ||
      immutableByteLength <= 0 ||
      typeof node.target?.id !== 'string'
    ) {
      return {};
    }

    immutableOffset += immutableByteLength;
  }

  if (immutableOffset === 0) {
    return {};
  }

  return {
    '0': [
      {
        length: immutableOffset,
        start: runtimeByteLength,
      },
    ],
  };
}

export function returnImmutableReferences(
  compilerVersion: string,
  creationBytecode: string,
  runtimeBytecode: string,
  auxdataStyle: AuxdataStyle,
): ImmutableReferences {
  let immutableReferences = {};
  if (gte(compilerVersion, '0.3.10')) {
    try {
      const { immutableSize } = decode(creationBytecode, auxdataStyle);
      if (immutableSize) {
        immutableReferences = {
          '0': [
            {
              length: immutableSize,
              start: runtimeBytecode.substring(2).length / 2,
            },
          ],
        };
      }
    } catch (e) {
      logWarn('Cannot decode vyper contract bytecode', {
        creationBytecode: creationBytecode,
      });
    }
  }
  return immutableReferences;
}

/**
 * Abstraction of a vyper compilation
 */
export class VyperCompilation extends AbstractCompilation {
  public language: CompilationLanguage = 'Vyper';
  // Use declare to override AbstractCompilation's types to target Vyper types
  declare jsonInput: VyperJsonInput;
  declare compilerOutput?: VyperOutput;
  declare compileAndReturnCompilationTarget: (
    forceEmscripten: boolean,
  ) => Promise<VyperOutputContract>;

  // Specify the auxdata style, used for extracting the auxdata from the compiler output
  public auxdataStyle:
    | AuxdataStyle.VYPER
    | AuxdataStyle.VYPER_LT_0_3_10
    | AuxdataStyle.VYPER_LT_0_3_5
    | AuxdataStyle.VYPER_LT_0_3_4;

  // Vyper version is not semver compliant, so we need to handle it differently
  public compilerVersionCompatibleWithSemver: string;

  initVyperJsonInput() {
    const outputs = [
      'abi',
      'ast',
      'interface',
      'ir',
      'evm.bytecode.object',
      'evm.bytecode.opcodes',
      'evm.deployedBytecode.object',
      'evm.deployedBytecode.opcodes',
      'evm.deployedBytecode.sourceMap',
      'evm.methodIdentifiers',
    ];

    // userdoc and devdoc are only supported from 0.2.0 onwards
    if (gte(this.compilerVersionCompatibleWithSemver, '0.2.0')) {
      outputs.push('userdoc');
      outputs.push('devdoc');
    }

    // layout is only supported from 0.4.1 onwards (including betas and rcs)
    if (gte(this.compilerVersionCompatibleWithSemver, '0.4.1')) {
      outputs.push('layout');
    }

    // evm.bytecode.sourceMap is only supported from 0.4.0rc4 onwards
    if (
      supportsCreationBytecodeSourceMap(
        this.compilerVersion,
        this.compilerVersionCompatibleWithSemver,
      )
    ) {
      outputs.push('evm.bytecode.sourceMap');
    }

    const outputSelection = {
      [this.compilationTarget.path]: outputs,
    };
    this.jsonInput.settings = { ...this.jsonInput.settings, outputSelection };
  }

  public constructor(
    public compiler: IVyperCompiler,
    compilerVersion: string,
    jsonInput: VyperJsonInput,
    public compilationTarget: CompilationTarget,
  ) {
    super(compilerVersion, jsonInput);

    // Vyper beta and rc versions are not semver compliant, so we need to handle them differently
    this.compilerVersionCompatibleWithSemver = returnFixedVyperVersion(
      this.compilerVersion,
    );

    this.auxdataStyle = returnAuxdataStyle(
      this.compilerVersionCompatibleWithSemver,
    );

    this.initVyperJsonInput();
  }

  get immutableReferences(): ImmutableReferences {
    return returnImmutableReferences(
      this.compilerVersionCompatibleWithSemver,
      this.creationBytecode,
      this.runtimeBytecode,
      this.auxdataStyle,
    );
  }

  get runtimeLinkReferences(): LinkReferences {
    // Vyper doesn't support libraries
    return {};
  }

  get creationLinkReferences(): LinkReferences {
    // Vyper doesn't support libraries
    return {};
  }

  public async compile() {
    await this.compileAndReturnCompilationTarget(false);
  }
  /**
   * Generate the cbor auxdata positions for the creation and runtime bytecodes.
   */
  public async generateCborAuxdataPositions() {
    try {
      const [, runtimeAuxdataCbor, runtimeCborLengthHex] = splitAuxdata(
        this.runtimeBytecode,
        this.auxdataStyle,
      );

      // Vyper 0.3.10 and higher does not have CBOR auxdata in the runtime bytecode
      if (
        runtimeAuxdataCbor &&
        runtimeCborLengthHex !== undefined &&
        (this.auxdataStyle === AuxdataStyle.VYPER_LT_0_3_10 ||
          this.auxdataStyle === AuxdataStyle.VYPER_LT_0_3_5)
      ) {
        this._runtimeBytecodeCborAuxdata = this.tryGenerateCborAuxdataPosition(
          this.runtimeBytecode,
          runtimeAuxdataCbor,
          runtimeCborLengthHex,
        );
      } else {
        this._runtimeBytecodeCborAuxdata = {};
      }

      const [, creationAuxdataCbor, creationCborLengthHex] = splitAuxdata(
        this.creationBytecode,
        this.auxdataStyle,
      );

      if (!creationAuxdataCbor || creationCborLengthHex === undefined) {
        this._creationBytecodeCborAuxdata = {};
        return;
      }
      this._creationBytecodeCborAuxdata = this.tryGenerateCborAuxdataPosition(
        this.creationBytecode,
        creationAuxdataCbor,
        creationCborLengthHex,
      );
    } catch (error) {
      logWarn('Cannot generate cbor auxdata positions', {
        error,
      });
      throw new CompilationError({
        code: 'cannot_generate_cbor_auxdata_positions',
      });
    }
  }

  private tryGenerateCborAuxdataPosition(
    bytecode: string,
    auxdataCbor: string,
    cborLengthHex: string,
  ): CompiledContractCborAuxdata {
    const auxdataFromRawBytecode = `${auxdataCbor}${cborLengthHex}`;

    // Handles vyper lower than 0.3.10 in which the auxdata length bytes count
    const auxdataLengthOffset =
      this.auxdataStyle === AuxdataStyle.VYPER_LT_0_3_10 ? 2 : 0;

    return {
      '1': {
        offset:
          // we divide by 2 because we store the length in bytes (without 0x)
          bytecode.substring(2).length / 2 -
          parseInt(
            cborLengthHex ||
              'b' /** handles vyper lower than 0.3.5 in which cborLengthHex is '' */,
            16,
          ) -
          auxdataLengthOffset,
        value: `0x${auxdataFromRawBytecode}`,
      },
    };
  }

  // Override the bytecodes' getter methods to not duplicate the 0x prefix
  get creationBytecode() {
    return this.contractCompilerOutput.evm.bytecode.object;
  }
  get runtimeBytecode() {
    return this.contractCompilerOutput.evm.deployedBytecode.object;
  }
}
