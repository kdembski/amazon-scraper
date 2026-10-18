import { ArgsService } from "@/shared/args/ArgsService";
import { ApiService } from "@/shared/backend/ApiService";
import { ScrapingClient } from "@/shared/http/ScrapingClient";
import { CronJob } from "cron";

export class ScraperStatusService {
  private static instance: ScraperStatusService;
  private apiService;
  private scrapingClient;

  private constructor(
    argsService = ArgsService.getInstance(),
    apiService = ApiService.getInstance(),
    scrapingClient = ScrapingClient.getInstance()
  ) {
    this.apiService = apiService;
    this.scrapingClient = scrapingClient;

    if (argsService.getTargetFlag().isPdp) {
      new CronJob("0 50 */1 * * *", () => this.send()).start();
    }
  }

  public static getInstance(): ScraperStatusService {
    if (!ScraperStatusService.instance) {
      ScraperStatusService.instance = new ScraperStatusService();
    }

    return ScraperStatusService.instance;
  }

  private send() {
    const { speed, pending } = this.scrapingClient.queueService;
    this.apiService.post(`scrapers/${process.env.name}/status`, {
      speed,
      pending,
    });
  }
}
