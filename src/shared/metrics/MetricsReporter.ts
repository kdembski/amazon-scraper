import { ArgsService } from "@/shared/args/ArgsService";
import { ApiService } from "@/shared/backend/ApiService";
import { ProxyService } from "@/shared/http/proxy/ProxyService";
import { TokenBucketQueue } from "@/shared/http/TokenBucketQueue";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { ProcessMetrics } from "@/shared/metrics/ProcessMetrics";
import { CronJob } from "cron";
import { randomUUID } from "crypto";

type UnsentReport = { key: string; body: unknown };

export class MetricsReporter {
  private static instance: MetricsReporter;
  private marketplace = "";
  private periodStart = new Date();
  private unsent?: UnsentReport;

  private constructor(
    private argsService = ArgsService.getInstance(),
    private apiService = ApiService.getInstance(),
    private metricsService = MetricsService.getInstance(),
    private queueService = TokenBucketQueue.getInstance(),
    private proxyService = ProxyService.getInstance(),
    private now = () => new Date(),
    private processMetrics = new ProcessMetrics()
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
    this.processMetrics.start(this.periodStart);
    new CronJob("0 * * * * *", () => this.send()).start();
  }

  // A report that failed goes out again unchanged with its key, before any newer one;
  // a 4xx drops it
  public async send() {
    if (this.unsent && !(await this.post(this.unsent))) return;

    const sentAt = this.now();
    this.proxyService.collectTraffic().forEach(({ labels, bytesIn, bytesOut }) => {
      if (bytesIn > 0) this.metricsService.increment("bytes_in", labels, bytesIn);
      if (bytesOut > 0) this.metricsService.increment("bytes_out", labels, bytesOut);
    });

    const counters = this.metricsService.drain();
    if (counters.length === 0) return;

    const processRows = await this.processMetrics.collect(sentAt);

    this.unsent = {
      key: randomUUID(),
      body: {
        marketplace: this.marketplace,
        flow: this.argsService.getTargetFlag(),
        periodStart: this.periodStart.toISOString(),
        metrics: [
          ...counters,
          { metric: "pending", value: this.queueService.pending },
          { metric: "queue_length", value: this.queueService.queue.length },
          {
            metric: "open_connections",
            value: this.proxyService.countConnections(),
          },
          ...processRows,
          ...this.metricsService.readGauges(),
        ],
      },
    };
    this.periodStart = sentAt;
    await this.post(this.unsent);
  }

  private async post(report: UnsentReport) {
    try {
      const name = await this.argsService.getScraperName();
      await this.apiService.send(`scrapers/${name}/metrics`, report.body, report.key);
      this.unsent = undefined;
      return true;
    } catch (e: any) {
      const status = e?.response?.status;
      console.error("metrics: report failed", status ?? e?.message);
      if (!status || status >= 500) return false;

      this.unsent = undefined;
      return true;
    }
  }
}
