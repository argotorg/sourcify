import type {
  LinkReferences,
  SolidityJsonInput,
} from '@ethereum-sourcify/compilers-types';
import { logWarn } from '../logger';

type LinkReferencePositions = { start: number; length: number }[];

// A placeholder is `__` + 36 characters + `__`. Hex bytecode has no `_`, so
// the pattern only matches placeholders.
const PLACEHOLDER_REGEX = /__(.{36})__/g;
const LABEL_LENGTH = 36;
const LIBRARY_DECLARATION_REGEX = /\blibrary\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
const COMMENT_OR_STRING_REGEX =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;

/**
 * solc-js translates the output of compilers without a standard JSON
 * interface (solc < 0.4.10 on Linux). The translated `linkReferences` is a
 * flat map keyed by the placeholder label instead of the standard JSON format
 * `{ "file.sol": { "Lib": [...] } }`. The map has more defects: it lists the
 * positions that solc-js linked with `settings.libraries`, it truncates the
 * label to 36 characters, it trims trailing underscores, and it can contain
 * phantom entries for placeholders that are close to each other.
 *
 * This function ignores the positions of the legacy map. It scans the
 * bytecode for placeholders and resolves each label to a fully qualified
 * library name. A standard JSON `linkReferences` is returned unchanged.
 */
export function normalizeLegacyLinkReferences(
  linkReferences: LinkReferences | undefined,
  bytecode: string,
  jsonInput: SolidityJsonInput,
): LinkReferences | undefined {
  if (!linkReferences || !isLegacyLinkReferences(linkReferences)) {
    return linkReferences;
  }

  const candidates = findLibraryCandidates(jsonInput);
  const normalized = new Map<string, Map<string, LinkReferencePositions>>();
  for (const match of bytecode.matchAll(PLACEHOLDER_REGEX)) {
    const { file, library } = resolveLabel(match[1], candidates);
    if (!normalized.has(file)) {
      normalized.set(file, new Map());
    }
    const fileLibraries = normalized.get(file)!;
    if (!fileLibraries.has(library)) {
      fileLibraries.set(library, []);
    }
    fileLibraries.get(library)!.push({ start: match.index / 2, length: 20 });
  }

  return Object.fromEntries(
    Array.from(normalized, ([file, fileLibraries]) => [
      file,
      Object.fromEntries(fileLibraries),
    ]),
  ) as LinkReferences;
}

function isLegacyLinkReferences(linkReferences: LinkReferences): boolean {
  return Object.values(linkReferences).some((value) => Array.isArray(value));
}

interface LibraryCandidate {
  file: string;
  library: string;
  // The label for the `__file:Lib__` format of solc 0.4.9
  fullyQualifiedLabel: string;
  // The label for the `__Lib__` format of solc < 0.4.9
  bareNameLabel: string;
}

function toLabel(name: string): string {
  return name.slice(0, LABEL_LENGTH).padEnd(LABEL_LENGTH, '_');
}

/**
 * Collects the libraries from `settings.libraries` and from the `library`
 * declarations in the sources. Comments and string literals are removed
 * before the sources are scanned.
 */
function findLibraryCandidates(jsonInput: SolidityJsonInput) {
  const candidates: LibraryCandidate[] = [];
  const addCandidate = (file: string, library: string) => {
    if (candidates.some((c) => c.file === file && c.library === library)) {
      return;
    }
    candidates.push({
      file,
      library,
      fullyQualifiedLabel: toLabel(`${file}:${library}`),
      bareNameLabel: toLabel(library),
    });
  };

  const libraries = jsonInput.settings?.libraries;
  if (libraries && typeof libraries === 'object') {
    for (const [file, fileLibraries] of Object.entries(libraries)) {
      if (fileLibraries && typeof fileLibraries === 'object') {
        for (const library of Object.keys(fileLibraries)) {
          addCandidate(file, library);
        }
      }
    }
  }

  for (const [file, source] of Object.entries(jsonInput.sources || {})) {
    if (typeof source?.content !== 'string') {
      continue;
    }
    const code = source.content.replace(COMMENT_OR_STRING_REGEX, ' ');
    for (const match of code.matchAll(LIBRARY_DECLARATION_REGEX)) {
      addCandidate(file, match[1]);
    }
  }
  return candidates;
}

/**
 * Matches the 36 character label of a placeholder against the candidates.
 * The first candidate with the same label wins. When no candidate matches,
 * the label is used as the library name with an empty file.
 */
function resolveLabel(label: string, candidates: LibraryCandidate[]) {
  const candidate =
    candidates.find((c) => c.fullyQualifiedLabel === label) ||
    candidates.find((c) => c.bareNameLabel === label);
  if (candidate) {
    return { file: candidate.file, library: candidate.library };
  }

  logWarn('Cannot resolve the library placeholder to a source file', {
    label,
  });
  const name = label.replace(/_+$/, '');
  const separator = name.lastIndexOf(':');
  return separator === -1
    ? { file: '', library: name }
    : { file: name.slice(0, separator), library: name.slice(separator + 1) };
}
