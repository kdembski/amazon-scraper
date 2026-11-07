import { monitorEventLoopDelay } from "node:perf_hooks";
import type { MetricRow } from "@/shared/metrics/metrics.types";
import { tcpPing } from "@/shared/utils/tcpPing";

const EVENT_LOOP_RESOLUTION_MS = 10;
const PING_HOST = "1.1.1.1";
const PING_PORT = 443;
const PING_TIMEOUT_MS = 2000;

export class ProcessMetrics {
  private cpu: NodeJS.CpuUsage = { user: 0, system: 0 };
  private cpuAt = new Date();

  constructor(
    private eventLoopDelay = monitorEventLoopDelay({
      resolution: EVENT_LOOP_RESOLUTION_MS,
    }),
    private cpuUsage = () => process.cpuUsage(),
    private memoryRss = () => process.memoryUsage.rss(),
    private heapUsed = () => process.memoryUsage().heapUsed,
    private ping = () => tcpPing(PING_HOST, PING_PORT, PING_TIMEOUT_MS)
  ) {}

  start(at: Date) {
    this.cpu = this.cpuUsage();
    this.cpuAt = at;
    this.eventLoopDelay.enable();
  }

  async collect(at: Date): Promise<MetricRow[]> {
    const eventLoopDelayMean = this.toDelayMs(this.eventLoopDelay.mean);
    const eventLoopDelayMax = this.toDelayMs(this.eventLoopDelay.max);
    this.eventLoopDelay.reset();
    const cpuPercent = this.measureCpuPercent(at);
    const pingMs = await this.ping();

    return [
      { metric: "event_loop_delay_mean_ms", value: eventLoopDelayMean },
      { metric: "event_loop_delay_max_ms", value: eventLoopDelayMax },
      { metric: "cpu_percent", value: cpuPercent },
      {
        metric: "memory_rss_mb",
        value: Math.round(this.memoryRss() / 1024 / 1024),
      },
      {
        metric: "heap_used_mb",
        value: Math.round(this.heapUsed() / 1024 / 1024),
      },
      pingMs === undefined
        ? { metric: "ping_failed", value: 1 }
        : { metric: "ping_ms", value: pingMs },
    ];
  }

  // Percent of one core since the previous measurement
  private measureCpuPercent(at: Date) {
    const cpu = this.cpuUsage();
    const usedMs =
      (cpu.user - this.cpu.user + cpu.system - this.cpu.system) / 1000;
    const elapsedMs = Math.max(at.getTime() - this.cpuAt.getTime(), 1);
    this.cpu = cpu;
    this.cpuAt = at;
    return Math.round((usedMs / elapsedMs) * 1000) / 10;
  }

  // The histogram includes the sampling interval; NaN without samples
  private toDelayMs(nanoseconds: number) {
    const ms = nanoseconds / 1e6 - EVENT_LOOP_RESOLUTION_MS;
    return Number.isFinite(ms) ? Math.max(Math.round(ms * 10) / 10, 0) : 0;
  }
}
