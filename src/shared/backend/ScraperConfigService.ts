import { CronJob } from "cron";
import { ArgsService } from "@/shared/args/ArgsService";
import { ApiService } from "@/shared/backend/ApiService";
import { TokenBucketQueue } from "@/shared/http/TokenBucketQueue";
import { getRetryDelay } from "@/shared/utils/retry";
import { sleep } from "@/shared/utils/sleep";

type ScraperConfig = {
  concurrency: number;
  rps: number;
  batchSize: number;
};

const MIN_VALUES: ScraperConfig = { concurrency: 1, rps: 0, batchSize: 1 };

export class ScraperConfigService {
  private static instance: ScraperConfigService;
  private config: ScraperConfig = { concurrency: 10, rps: 0, batchSize: 50 };

  private constructor(
    private apiService = ApiService.getInstance(),
    private queue = TokenBucketQueue.getInstance(),
    private argsService = ArgsService.getInstance()
  ) {}

  public static getInstance(): ScraperConfigService {
    if (!ScraperConfigService.instance) {
      ScraperConfigService.instance = new ScraperConfigService();
    }

    return ScraperConfigService.instance;
  }

  get() {
    return this.config;
  }

  async load() {
    for (let failed = 1; ; failed++) {
      try {
        return this.apply(await this.fetch());
      } catch (e) {
        console.error("config: load failed", e);
        await sleep(getRetryDelay(failed));
      }
    }
  }

  start() {
    new CronJob("0 * * * * *", () => this.refresh()).start();
  }

  async refresh() {
    try {
      this.apply(await this.fetch());
    } catch (e) {
      console.error("config: refresh failed", e);
    }
  }

  private async fetch() {
    return this.apiService.get<ScraperConfig>(
      `scrapers/${await this.argsService.getScraperName()}/config`,
      { timeout: 10 * 1000 }
    );
  }

  private apply(next: ScraperConfig) {
    const keys = Object.keys(MIN_VALUES) as (keyof ScraperConfig)[];
    const config = { ...this.config };

    keys.forEach((key) => {
      const value = next[key];
      if (!Number.isInteger(value) || value < MIN_VALUES[key]) {
        console.warn(`config: invalid ${key} ${value}`);
        return;
      }
      if (value === config[key]) return;

      console.log(`config: ${key} ${config[key]} -> ${value}`);
      config[key] = value;
    });

    this.queue.concurrency = config.concurrency;
    if (config.rps !== this.queue.rps) this.queue.setRps(config.rps);
    this.config = config;
  }
}
