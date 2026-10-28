import { ArgsService } from "@/shared/args/ArgsService";
import { ApiService } from "@/shared/backend/ApiService";
import { ProxyService } from "@/shared/http/proxy/ProxyService";
import { ScrapingClient } from "@/shared/http/ScrapingClient";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { tcpPing } from "@/shared/utils/tcpPing";
import { CronJob } from "cron";
import { monitorEventLoopDelay } from "node:perf_hooks";

const EVENT_LOOP_RESOLUTION_MS = 10;
const PING_HOST = "1.1.1.1";
const PING_PORT = 443;
const PING_TIMEOUT_MS = 2000;

export class MetricsReporter {
  private static instance: MetricsReporter;
  private marketplace = "";
  private periodStart = new Date();
  private cpu: NodeJS.CpuUsage = { user: 0, system: 0 };
  private cpuAt = new Date();
  private timeout = 30 * 1000;

  private constructor(
    private argsService = ArgsService.getInstance(),
    private apiService = ApiService.getInstance(),
    private metricsService = MetricsService.getInstance(),
    private scrapingClient = ScrapingClient.getInstance(),
    private proxyService = ProxyService.getInstance(),
    private now = () => new Date(),
    private eventLoopDelay = monitorEventLoopDelay({
      resolution: EVENT_LOOP_RESOLUTION_MS,
    }),
    private cpuUsage = () => process.cpuUsage(),
    private memoryRss = () => process.memoryUsage.rss(),
    private ping = () => tcpPing(PING_HOST, PING_PORT, PING_TIMEOUT_MS)
  ) {}

  public static getInstance(): MetricsReporter {
    if (!MetricsReporter.instance) {
      MetricsReporter.instance = new MetricsReporter();
    }

    return MetricsReporter.instance;
  }

  public start(marketplace: string) {
    this.marketplace = marketplace;
    this.periodStart = this.now();
    this.cpu = this.cpuUsage();
    this.cpuAt = this.periodStart;
    this.eventLoopDelay.enable();
    new CronJob("0 * * * * *", () => this.send()).start();
  }

  public async send() {
    const sentAt = this.now();
    const { bytesIn, bytesOut } = this.proxyService.collectTraffic();
    if (bytesIn > 0) this.metricsService.increment("bytes_in", {}, bytesIn);
    if (bytesOut > 0) this.metricsService.increment("bytes_out", {}, bytesOut);

    const counters = this.metricsService.drain();
    if (counters.length === 0) return;

    const { queueService } = this.scrapingClient;
    const eventLoopDelayMean = this.toDelayMs(this.eventLoopDelay.mean);
    const eventLoopDelayMax = this.toDelayMs(this.eventLoopDelay.max);
    this.eventLoopDelay.reset();
    const cpuPercent = this.measureCpuPercent(sentAt);
    const pingMs = await this.ping();

    const response = await this.apiService.post(
      `scrapers/${process.env.name}/metrics`,
      {
        marketplace: this.marketplace,
        flow: this.argsService.getTargetFlag(),
        periodStart: this.periodStart.toISOString(),
        metrics: [
          ...counters,
          { metric: "pending", value: queueService.pending },
          { metric: "queue_length", value: queueService.queue.length },
          {
            metric: "open_connections",
            value: this.proxyService.countConnections(),
          },
          { metric: "event_loop_delay_mean_ms", value: eventLoopDelayMean },
          { metric: "event_loop_delay_max_ms", value: eventLoopDelayMax },
          { metric: "cpu_percent", value: cpuPercent },
          {
            metric: "memory_rss_mb",
            value: Math.round(this.memoryRss() / 1024 / 1024),
          },
          pingMs === undefined
            ? { metric: "ping_failed", value: 1 }
            : { metric: "ping_ms", value: pingMs },
        ],
      },
      { timeout: this.timeout }
    );

    if (response === undefined) {
      this.metricsService.restore(counters);
      return;
    }
    this.periodStart = sentAt;
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
