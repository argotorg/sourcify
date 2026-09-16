import { performance } from "node:perf_hooks";
import type { EventLoopUtilization } from "node:perf_hooks";
import type { Worker } from "node:worker_threads";
import logger from "../../../common/logger";
import type { RunningTaskInfo, WorkerPoolStats } from "../VerificationService";
import type {
  HotWorkerObservation,
  HotWorkerProfilerOptions,
} from "./HotWorkerProfiler";
import { HotWorkerProfiler } from "./HotWorkerProfiler";

export interface RuntimeStatsOptions {
  intervalMs: number;
  // Undefined keeps the hot worker CPU profile off
  cpuProfile?: HotWorkerProfilerOptions;
}

/**
 * What the stats need from the VerificationService. Kept minimal so the
 * worker pool stays private and tests can pass a fake.
 */
export interface RuntimeStatsSource {
  getWorkerThreads(): Worker[];
  getWorkerPoolStats(): WorkerPoolStats;
  getRunningTasksByThread(threadId: number): RunningTaskInfo[];
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Logs one "Runtime stats" line per interval: event loop utilization (ELU)
 * of the main thread and of each worker thread with the jobs it runs, the
 * worker pool counters, and CPU and memory of the process.
 *
 * The gap between `cpu.cores` and `mainElu + sum(workers.elu)` is CPU spent
 * outside the JavaScript event loops (GC helpers, libuv pool, compiler
 * subprocesses are not included because they are separate processes).
 */
export class RuntimeStats {
  private timer?: NodeJS.Timeout;
  private prevMainElu: EventLoopUtilization;
  private prevWorkerElu = new Map<number, EventLoopUtilization>();
  private prevCpu: NodeJS.CpuUsage;
  private prevTickAt: number;
  private profiler?: HotWorkerProfiler;

  constructor(
    private source: RuntimeStatsSource,
    private options: RuntimeStatsOptions,
    profiler?: HotWorkerProfiler,
  ) {
    this.prevMainElu = performance.eventLoopUtilization();
    this.prevCpu = process.cpuUsage();
    this.prevTickAt = performance.now();

    if (profiler) {
      this.profiler = profiler;
    } else if (options.cpuProfile) {
      if (HotWorkerProfiler.isSupported()) {
        this.profiler = new HotWorkerProfiler(options.cpuProfile);
      } else {
        logger.warn(
          "Hot worker thread CPU profile is not available, it needs Node >= 22.20",
          { nodeVersion: process.version },
        );
      }
    }
  }

  start(): void {
    if (this.timer) {
      return;
    }
    logger.info("Starting runtime stats", {
      intervalMs: this.options.intervalMs,
      cpuProfile: this.profiler ? this.options.cpuProfile : "disabled",
    });
    this.timer = setInterval(() => this.tick(), this.options.intervalMs);
    // Must not keep the process alive
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Collects and logs one stats line and hands the worker observations to
   * the profiler. Returns the pending profile capture if one was started.
   */
  tick(): Promise<void> | undefined {
    try {
      const observations = this.observeWorkers();
      this.logStats(observations);
      return this.profiler?.observe(observations);
    } catch (error) {
      logger.warn("Failed to collect runtime stats", { error });
      return undefined;
    }
  }

  private observeWorkers(): HotWorkerObservation[] {
    const threads = this.source.getWorkerThreads();
    const seenThreads = new Set<number>();
    const observations: HotWorkerObservation[] = [];

    for (const worker of threads) {
      const { threadId } = worker;
      seenThreads.add(threadId);
      let elu: number | null = null;
      try {
        const current = worker.performance.eventLoopUtilization();
        const prev = this.prevWorkerElu.get(threadId);
        if (prev) {
          elu = round(
            worker.performance.eventLoopUtilization(current, prev).utilization,
            3,
          );
        }
        this.prevWorkerElu.set(threadId, current);
      } catch (error) {
        // The thread may have exited between the two calls
        logger.debug("Failed to read worker event loop utilization", {
          threadId,
          error,
        });
      }
      observations.push({
        worker,
        elu,
        tasks: this.source.getRunningTasksByThread(threadId),
      });
    }

    for (const threadId of this.prevWorkerElu.keys()) {
      if (!seenThreads.has(threadId)) {
        this.prevWorkerElu.delete(threadId);
      }
    }
    return observations;
  }

  private logStats(observations: HotWorkerObservation[]): void {
    const now = performance.now();
    const intervalMs = now - this.prevTickAt;
    this.prevTickAt = now;

    const mainElu = performance.eventLoopUtilization(this.prevMainElu);
    this.prevMainElu = performance.eventLoopUtilization();

    const cpu = process.cpuUsage(this.prevCpu);
    this.prevCpu = process.cpuUsage();
    const userMs = cpu.user / 1000;
    const systemMs = cpu.system / 1000;

    const pool = this.source.getWorkerPoolStats();

    logger.info("Runtime stats", {
      uptimeSec: Math.round(process.uptime()),
      intervalMs: Math.round(intervalMs),
      mainElu: round(mainElu.utilization, 3),
      workers: observations.map(({ worker, elu, tasks }) => ({
        threadId: worker.threadId,
        elu,
        tasks,
      })),
      pool: {
        utilization: round(pool.utilization, 3),
        queueSize: pool.queueSize,
        completed: pool.completed,
        threads: pool.threads,
        runTime: {
          p50: round(pool.runTime.p50, 1),
          p99: round(pool.runTime.p99, 1),
        },
        waitTime: {
          p50: round(pool.waitTime.p50, 1),
          p99: round(pool.waitTime.p99, 1),
        },
      },
      cpu: {
        userMs: Math.round(userMs),
        systemMs: Math.round(systemMs),
        cores: round((userMs + systemMs) / intervalMs, 2),
      },
      mem: {
        rss: process.memoryUsage().rss,
        // In kilobytes
        maxRSS: process.resourceUsage().maxRSS,
      },
    });
  }
}
