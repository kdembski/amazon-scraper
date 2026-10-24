import { CronJob } from "cron";
import { ApiService } from "@/shared/backend/ApiService";
import { ScrapingClient } from "@/shared/http/ScrapingClient";
import { getRetryDelay } from "@/shared/utils/retry";

export type ScraperConfig = {
  concurrency: number;
  rps: number;
  batchSize: number;
};

const MIN_VALUES: ScraperConfig = { concurrency: 1, rps: 0, batchSize: 1 };

export class ScraperConfigService {
  private static instance: ScraperConfigService;
  private apiService;
  private getQueue;
  private config: ScraperConfig = { concurrency: 10, rps: 0, batchSize: 50 };

  private constructor(
    apiService = ApiService.getInstance(),
    getQueue = () => ScrapingClient.getInstance().queueService
  ) {
    this.apiService = apiService;
    this.getQueue = getQueue;
  }

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
        await new Promise((resolve) => setTimeout(resolve, getRetryDelay(failed)));
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

  private fetch() {
    return this.apiService.get<ScraperConfig>(
      `scrapers/${process.env.name}/config`,
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

    const queue = this.getQueue();
    queue.concurrency = config.concurrency;
    if (config.rps !== queue.rps) queue.setRps(config.rps);
    this.config = config;
  }
}
