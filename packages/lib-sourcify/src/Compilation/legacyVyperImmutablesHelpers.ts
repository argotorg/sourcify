import type {
  VyperIROutput,
  VyperOutput,
  ImmutableReferences,
} from '@ethereum-sourcify/compilers-types';
import type { CompilationTarget } from './CompilationTypes';

// Helpers for recovering immutable references on legacy Vyper contracts
// (0.3.1 <= version < 0.3.10), where the immutable section size is not encoded
// in the CBOR auxdata and must be derived from the compiler `ir` output.

const WORD_SIZE = 32;
const LEGACY_VYPER_TEXT_IR_IMMUTABLE_RETURN =
  /\[return,\s*(\d+),\s*\[add,\s*(\d+),\s*_lllsz\]\]/g;

function isRecord(
  value: VyperIROutput,
): value is { [key: string]: VyperIROutput } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isValidImmutableLength(
  length: VyperIROutput,
): length is number {
  return (
    typeof length === 'number' &&
    Number.isSafeInteger(length) &&
    length > 0 &&
    length % WORD_SIZE === 0
  );
}

function collectStructuredIrImmutableLengths(
  node: VyperIROutput,
  lengths: number[] = [],
): number[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      collectStructuredIrImmutableLengths(child, lengths);
    }
    return lengths;
  }

  if (!isRecord(node)) {
    return lengths;
  }

  const deployNode = node.deploy;
  if (Array.isArray(deployNode) && isValidImmutableLength(deployNode[2])) {
    lengths.push(deployNode[2]);
  }

  for (const child of Object.values(node)) {
    collectStructuredIrImmutableLengths(child, lengths);
  }
  return lengths;
}

function extractTextIrImmutableLengths(ir: string): number[] {
  const lengths: number[] = [];
  for (const match of ir.matchAll(LEGACY_VYPER_TEXT_IR_IMMUTABLE_RETURN)) {
    const length = Number(match[2]);
    if (isValidImmutableLength(length)) {
      lengths.push(length);
    }
  }
  return lengths;
}

function getLegacyVyperImmutableLengthFromIr(
  ir: VyperIROutput | undefined,
): number | undefined {
  if (ir === undefined) {
    return undefined;
  }
  const lengths =
    typeof ir === 'string'
      ? extractTextIrImmutableLengths(ir) // 0.3.1: text LLL
      : collectStructuredIrImmutableLengths(ir); // 0.3.2-0.3.9: structured IR tree

  if (lengths.length !== 1) {
    return undefined;
  }
  return lengths[0];
}

export function returnLegacyVyperImmutableReferences(
  compilerOutput: VyperOutput | undefined,
  compilationTarget: CompilationTarget,
  runtimeBytecode: string,
): ImmutableReferences {
  const compilationTargetContract =
    compilerOutput?.contracts?.[compilationTarget.path]?.[
      compilationTarget.name
    ];
  const immutableLength = getLegacyVyperImmutableLengthFromIr(
    compilationTargetContract?.ir,
  );
  if (immutableLength === undefined) {
    return {};
  }

  const runtimeByteLength = runtimeBytecode.substring(2).length / 2;

  return {
    '0': [
      {
        length: immutableLength,
        start: runtimeByteLength,
      },
    ],
  };
}
