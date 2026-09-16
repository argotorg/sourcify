/**
 * Summarizes a V8 CPU profile in the Chrome DevTools `.cpuprofile` format,
 * as returned by `worker.startCpuProfile()`, into something small enough for
 * one log line.
 */

export interface CpuProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    url: string;
    // 0-based
    lineNumber: number;
    columnNumber?: number;
    scriptId?: number | string;
  };
  hitCount?: number;
  children?: number[];
  // 1-based lines with their sample counts, only present for hit nodes
  positionTicks?: { line: number; ticks: number }[];
}

export interface CpuProfile {
  nodes: CpuProfileNode[];
  // Node ids, one per sample
  samples: number[];
  timeDeltas?: number[];
  startTime?: number;
  endTime?: number;
}

export interface HotFrame {
  fn: string;
  url: string;
  // 1-based
  line: number;
  pct: number;
  hotLines: { line: number; ticks: number }[];
}

export interface HotStack {
  pct: number;
  // Frames from leaf to root, e.g. "fn url:line < caller url:line"
  stack: string;
}

export interface CpuProfileSummary {
  sampleCount: number;
  topSelf: HotFrame[];
  topStacks: HotStack[];
  // Percent of samples in V8's special nodes
  special: { garbageCollector: number; idle: number; program: number };
}

const SPECIAL_FUNCTION_NAMES: Record<
  string,
  keyof CpuProfileSummary["special"]
> = {
  "(garbage collector)": "garbageCollector",
  "(idle)": "idle",
  "(program)": "program",
};
const MAX_STACK_FRAMES = 25;
const MAX_HOT_LINES = 3;
const URL_PREFIX_MARKERS = ["/node_modules/", "/dist/", "/src/"];

/**
 * Removes the absolute path prefix, keeping the path from `node_modules/`,
 * `dist/` or `src/` on.
 */
export function shortenUrl(url: string): string {
  const path = url.replace(/^file:\/\//, "");
  for (const marker of URL_PREFIX_MARKERS) {
    const index = path.indexOf(marker);
    if (index >= 0) {
      return path.slice(index + 1);
    }
  }
  return path;
}

function formatFrame(node: CpuProfileNode): string {
  const { functionName, url, lineNumber } = node.callFrame;
  const fn = functionName || "(anonymous)";
  return url ? `${fn} ${shortenUrl(url)}:${lineNumber + 1}` : fn;
}

function toPercent(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 10;
}

export function summarizeCpuProfile(
  profile: CpuProfile,
  topN: number,
): CpuProfileSummary {
  const nodesById = new Map<number, CpuProfileNode>();
  const parentById = new Map<number, number>();
  for (const node of profile.nodes) {
    nodesById.set(node.id, node);
    for (const childId of node.children ?? []) {
      parentById.set(childId, node.id);
    }
  }

  const sampleCount = profile.samples.length;
  const selfSamples = new Map<number, number>();
  for (const nodeId of profile.samples) {
    selfSamples.set(nodeId, (selfSamples.get(nodeId) ?? 0) + 1);
  }

  const special = { garbageCollector: 0, idle: 0, program: 0 };
  const stackSamples = new Map<string, number>();
  const frames: HotFrame[] = [];

  for (const [nodeId, count] of selfSamples) {
    const node = nodesById.get(nodeId);
    if (!node) {
      continue;
    }
    const specialKey = SPECIAL_FUNCTION_NAMES[node.callFrame.functionName];
    if (specialKey) {
      special[specialKey] += count;
      continue;
    }

    frames.push({
      fn: node.callFrame.functionName || "(anonymous)",
      url: shortenUrl(node.callFrame.url),
      line: node.callFrame.lineNumber + 1,
      pct: toPercent(count, sampleCount),
      hotLines: [...(node.positionTicks ?? [])]
        .sort((a, b) => b.ticks - a.ticks)
        .slice(0, MAX_HOT_LINES)
        .map(({ line, ticks }) => ({ line, ticks })),
    });

    const stack = buildStack(node, nodesById, parentById);
    stackSamples.set(stack, (stackSamples.get(stack) ?? 0) + count);
  }

  const topSelf = frames.sort((a, b) => b.pct - a.pct).slice(0, topN);
  const topStacks = [...stackSamples.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([stack, count]) => ({ pct: toPercent(count, sampleCount), stack }));

  return {
    sampleCount,
    topSelf,
    topStacks,
    special: {
      garbageCollector: toPercent(special.garbageCollector, sampleCount),
      idle: toPercent(special.idle, sampleCount),
      program: toPercent(special.program, sampleCount),
    },
  };
}

function buildStack(
  leaf: CpuProfileNode,
  nodesById: Map<number, CpuProfileNode>,
  parentById: Map<number, number>,
): string {
  const frames: string[] = [];
  let node: CpuProfileNode | undefined = leaf;
  let truncated = false;
  while (node && node.callFrame.functionName !== "(root)") {
    if (frames.length === MAX_STACK_FRAMES) {
      truncated = true;
      break;
    }
    frames.push(formatFrame(node));
    const parentId = parentById.get(node.id);
    node = parentId === undefined ? undefined : nodesById.get(parentId);
  }
  return frames.join(" < ") + (truncated ? " < ..." : "");
}
