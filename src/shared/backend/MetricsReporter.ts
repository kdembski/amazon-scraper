import { ArgsService } from "@/shared/args/ArgsService";
import { ApiService } from "@/shared/backend/ApiService";
import { ProxyService } from "@/shared/http/proxy/ProxyService";
import { ScrapingClient } from "@/shared/http/ScrapingClient";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { CronJob } from "cron";
import { monitorEventLoopDelay } from "node:perf_hooks";

const EVENT_LOOP_RESOLUTION_MS = 10;

export class MetricsReporter {
  private static instance: MetricsReporter;
  private argsService;
  private apiService;
  private metricsService;
  private scrapingClient;
  private proxyService;
  private now;
  private eventLoopDelay;
  private marketplace = "";
  private periodStart = new Date();
  private timeout = 30 * 1000;

  private constructor(
    argsService = ArgsService.getInstance(),
    apiService = ApiService.getInstance(),
    metricsService = MetricsService.getInstance(),
    scrapingClient = ScrapingClient.getInstance(),
    proxyService = ProxyService.getInstance(),
    now = () => new Date(),
    eventLoopDelay = monitorEventLoopDelay({
      resolution: EVENT_LOOP_RESOLUTION_MS,
    })
  ) {
    this.argsService = argsService;
    this.apiService = apiService;
    this.metricsService = metricsService;
    this.scrapingClient = scrapingClient;
    this.proxyService = proxyService;
    this.now = now;
    this.eventLoopDelay = eventLoopDelay;
  }

  public static getInstance(): MetricsReporter {
    if (!MetricsReporter.instance) {
      MetricsReporter.instance = new MetricsReporter();
    }

    return MetricsReporter.instance;
  }

  public start(marketplace: string) {
    this.marketplace = marketplace;
    this.periodStart = this.now();
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

    const response = await this.apiService.post(
      `scrapers/${process.env.name}/metrics`,
      {
        marketplace: this.marketplace,
        flow: this.argsService.getTargetFlag().isPlp ? "plp" : "pdp",
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

  // The histogram includes the sampling interval; NaN without samples
  private toDelayMs(nanoseconds: number) {
    const ms = nanoseconds / 1e6 - EVENT_LOOP_RESOLUTION_MS;
    return Number.isFinite(ms) ? Math.max(Math.round(ms * 10) / 10, 0) : 0;
  }
}
