import { PathContent, VariedPathContent } from './ValidationTypes';
import { id as keccak256str } from 'ethers';

export const CONTENT_VARIATORS = [
  (content: string) => content.replace(/\r?\n/g, '\r\n'),
  (content: string) => content.replace(/\r\n/g, '\n'),
];

export const ENDING_VARIATORS = [
  (content: string) => content.trimEnd(),
  (content: string) => content.trimEnd() + '\n',
  (content: string) => content.trimEnd() + '\r\n',
  (content: string) => content + '\n',
  (content: string) => content + '\r\n',
];

/**
 * The groupBy function is a function that takes an
 * array and a key as input,and returns an object containing
 * an index of the array elements grouped by the value of
 * the specified key.
 */
export function groupBy<T extends { [index: string]: any }>(
  xs: T[],
  key: string,
): { index?: T[] } {
  return xs.reduce(function (rv: { [index: string]: T[] }, x: T) {
    (rv[x[key]] = rv[x[key]] || []).push(x);
    return rv;
  }, {});
}

export function reorderAlphabetically(obj: any): any {
  // Do not reorder arrays or other types
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return obj;
  }

  const ordered: any = {};

  Object.keys(obj)
    .sort((a, b) => a.localeCompare(b))
    .forEach((key: string) => {
      ordered[key] = reorderAlphabetically(obj[key]);
    });

  return ordered;
}

export function generateVariations(
  pathContent: PathContent,
): VariedPathContent[] {
  const variations: {
    content: string;
    contentVariator: number;
    endingVariator: number;
  }[] = [];
  const original = pathContent.content;
  for (const [
    CONTENT_VARIATORS_INDEX,
    contentVariator,
  ] of CONTENT_VARIATORS.entries()) {
    const variatedContent = contentVariator(original);
    for (const [
      ENDING_VARIATORS_INDEX,
      endingVariator,
    ] of ENDING_VARIATORS.entries()) {
      const variation = endingVariator(variatedContent);
      variations.push({
        content: variation,
        contentVariator: CONTENT_VARIATORS_INDEX,
        endingVariator: ENDING_VARIATORS_INDEX,
      });
    }
  }

  return variations.map(({ content, contentVariator, endingVariator }) => {
    return {
      content,
      path: pathContent.path,
      variation: contentVariator + '.' + endingVariator,
    };
  });
}

/**
 * Generates a map of files indexed by the keccak hash of their content.
 *
 * @param  {string[]}  files Array containing sources.
 * @returns Map object that maps hash to PathContent.
 */
export function getVariationsByContentHash(
  files: PathContent[],
): Map<string, VariedPathContent> {
  const byHash: Map<string, VariedPathContent> = new Map();

  for (const pathContent of files) {
    for (const variation of generateVariations(pathContent)) {
      const calculatedHash = keccak256str(variation.content);
      byHash.set(calculatedHash, variation);
    }
  }

  return byHash;
}
