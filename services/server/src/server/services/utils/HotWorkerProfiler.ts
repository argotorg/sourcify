import { Worker } from "node:worker_threads";
import logger from "../../../common/logger";
import type { RunningTaskInfo } from "../VerificationService";
import { summarizeCpuProfile } from "./cpu-profile-util";

export interface HotWorkerProfilerOptions {
  // Event loop utilization (0..1) at which a thread counts as busy
  eluThreshold: number;
  // Consecutive busy ticks before a thread is profiled
  sustainTicks: number;
  durationMs: number;
  // Minimum time between two profiles
  cooldownMs: number;
  // Frames and stacks kept in the summary
  topN: number;
}

/**
 * The part of `worker_threads.Worker` this class uses. `startCpuProfile`
 * exists since Node 22.20 and is missing from the bundled typings.
 */
export interface ProfilableWorker {
  threadId: number;
  startCpuProfile?: (name: string) => Promise<{ stop(): Promise<string> }>;
}

export interface HotWorkerObservation {
  worker: ProfilableWorker;
  // Null on the first tick a thread is seen
  elu: number | null;
  tasks: RunningTaskInfo[];
}

interface HotWorkerProfilerDeps {
  now: () => number;
  wait: (ms: number) => Promise<void>;
}

// Bounds every await on a worker that may exit at any time
const WORKER_CALL_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} did not finish in time`)),
      WORKER_CALL_TIMEOUT_MS,
    );
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Takes one CPU profile of a worker thread that stays busy for
 * `sustainTicks` observations and logs a summary of it together with the
 * jobs the thread runs. The profiled thread is slowed down by a few percent
 * while the profile runs; other threads are not affected.
 */
export class HotWorkerProfiler {
  private hotTicks = new Map<number, number>();
  private lastProfileStartedAt?: number;
  private inProgress = false;

  constructor(
    private options: HotWorkerProfilerOptions,
    private deps: HotWorkerProfilerDeps = {
      now: () => Date.now(),
      wait: (ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms).unref();
        }),
    },
  ) {}

  static isSupported(): boolean {
    const prototype = Worker.prototype as unknown as ProfilableWorker;
    return typeof prototype.startCpuProfile === "function";
  }

  /**
   * Feeds one tick of observations. Returns the pending capture if this
   * tick started one, so callers can await it.
   */
  observe(observations: HotWorkerObservation[]): Promise<void> | undefined {
    const seenThreads = new Set<number>();
    let candidate: HotWorkerObservation | undefined;

    for (const observation of observations) {
      const { threadId } = observation.worker;
      seenThreads.add(threadId);
      const isHot =
        observation.elu !== null &&
        observation.elu >= this.options.eluThreshold;
      const hotTicks = isHot ? (this.hotTicks.get(threadId) ?? 0) + 1 : 0;
      this.hotTicks.set(threadId, hotTicks);
      if (hotTicks >= this.options.sustainTicks && !candidate) {
        candidate = observation;
      }
    }
    for (const threadId of this.hotTicks.keys()) {
      if (!seenThreads.has(threadId)) {
        this.hotTicks.delete(threadId);
      }
    }

    if (!candidate || this.inProgress || this.isInCooldown()) {
      return undefined;
    }
    // Requires the thread to stay busy for another sustain period
    this.hotTicks.set(candidate.worker.threadId, 0);
    return this.capture(candidate);
  }

  private isInCooldown(): boolean {
    return (
      this.lastProfileStartedAt !== undefined &&
      this.deps.now() - this.lastProfileStartedAt < this.options.cooldownMs
    );
  }

  private async capture(observation: HotWorkerObservation): Promise<void> {
    const { worker, elu: eluBefore, tasks } = observation;
    const { threadId } = worker;
    const { durationMs, topN } = this.options;
    this.inProgress = true;
    this.lastProfileStartedAt = this.deps.now();

    try {
      if (typeof worker.startCpuProfile !== "function") {
        throw new Error("worker.startCpuProfile is not available");
      }
      const handle = await withTimeout(
        worker.startCpuProfile(`hot-thread-${threadId}`),
        "startCpuProfile",
      );
      await this.deps.wait(durationMs);
      const rawProfile = await withTimeout(handle.stop(), "stop");
      const summary = summarizeCpuProfile(JSON.parse(rawProfile), topN);

      const now = this.deps.now();
      logger.warn("Hot worker thread CPU profile", {
        threadId,
        durationMs,
        eluBefore,
        tasks: tasks.map((task) => ({
          ...task,
          runningForMs: now - task.startedAt.getTime(),
        })),
        ...summary,
      });
    } catch (error) {
      // The thread may have exited or been terminated during the capture
      logger.warn("Failed to profile hot worker thread", {
        threadId,
        error,
      });
    } finally {
      this.inProgress = false;
    }
  }
}
