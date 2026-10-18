import { ArgsService } from "@/shared/args/ArgsService";
import { ApiService } from "@/shared/backend/ApiService";
import { ProxyService } from "@/shared/http/proxy/ProxyService";
import { ScrapingClient } from "@/shared/http/ScrapingClient";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { CronJob } from "cron";

export class MetricsReporter {
  private static instance: MetricsReporter;
  private argsService;
  private apiService;
  private metricsService;
  private scrapingClient;
  private proxyService;
  private now;
  private marketplace = "";
  private periodStart = new Date();
  private timeout = 30 * 1000;

  private constructor(
    argsService = ArgsService.getInstance(),
    apiService = ApiService.getInstance(),
    metricsService = MetricsService.getInstance(),
    scrapingClient = ScrapingClient.getInstance(),
    proxyService = ProxyService.getInstance(),
    now = () => new Date()
  ) {
    this.argsService = argsService;
    this.apiService = apiService;
    this.metricsService = metricsService;
    this.scrapingClient = scrapingClient;
    this.proxyService = proxyService;
    this.now = now;
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
}
