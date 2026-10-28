import type {
  LinkReferences,
  SolidityJsonInput,
} from '@ethereum-sourcify/compilers-types';

type LinkReferencePositions = { start: number; length: number }[];

/**
 * solc-js translates the output of compilers without a standard JSON
 * interface (solc < 0.4.10 on Linux). The translated `linkReferences` is a
 * flat map keyed by the placeholder label: `{ "Lib": [...] }` before 0.4.9
 * and `{ "file.sol:Lib": [...] }` for 0.4.9. The map also lists the positions
 * that solc-js linked with `settings.libraries`.
 *
 * This function converts the map to the standard JSON format
 * `{ "file.sol": { "Lib": [...] } }` and drops the linked positions.
 * It returns a standard JSON `linkReferences` unchanged.
 */
export function normalizeLegacyLinkReferences(
  linkReferences: LinkReferences | undefined,
  bytecode: string,
  jsonInput: SolidityJsonInput,
): LinkReferences | undefined {
  if (!linkReferences || !isLegacyLinkReferences(linkReferences)) {
    return linkReferences;
  }

  const normalized: LinkReferences = {};
  const legacyLinkReferences = linkReferences as unknown as Record<
    string,
    LinkReferencePositions
  >;
  for (const [label, positions] of Object.entries(legacyLinkReferences)) {
    const { file, library } = splitLabel(label, jsonInput);
    const unlinkedPositions = positions.filter(({ start, length }) =>
      isPlaceholder(bytecode.slice(start * 2, (start + length) * 2)),
    );
    if (unlinkedPositions.length === 0) {
      continue;
    }
    if (!normalized[file]) {
      normalized[file] = {};
    }
    normalized[file][library] =
      unlinkedPositions as LinkReferences[string][string];
  }
  return normalized;
}

function isLegacyLinkReferences(linkReferences: LinkReferences): boolean {
  return Object.values(linkReferences).some((value) => Array.isArray(value));
}

function isPlaceholder(bytecodeSlice: string): boolean {
  return /^__.{36}__$/.test(bytecodeSlice);
}

function splitLabel(
  label: string,
  jsonInput: SolidityJsonInput,
): { file: string; library: string } {
  const separator = label.lastIndexOf(':');
  if (separator !== -1) {
    return {
      file: label.slice(0, separator),
      library: label.slice(separator + 1),
    };
  }
  return { file: findLibraryFile(label, jsonInput), library: label };
}

/**
 * The bare-name placeholder does not contain the file. Look it up in
 * `settings.libraries` first, then in the source files.
 */
function findLibraryFile(library: string, jsonInput: SolidityJsonInput) {
  const libraries = jsonInput.settings?.libraries || {};
  for (const [file, fileLibraries] of Object.entries(libraries)) {
    if (library in fileLibraries) {
      return file;
    }
  }

  const escapedLibrary = library.replace(/\$/g, '\\$');
  const declaration = new RegExp(`\\blibrary\\s+${escapedLibrary}\\b`);
  for (const [file, source] of Object.entries(jsonInput.sources)) {
    if (source.content && declaration.test(source.content)) {
      return file;
    }
  }
  return '';
}
