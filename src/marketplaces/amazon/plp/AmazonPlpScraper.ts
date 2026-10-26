import { MarketplaceScraper } from "@/shared/interfaces/MarketplaceScraper";
import { AmazonPlpCategoryScraper } from "@/marketplaces/amazon/plp/AmazonPlpCategoryScraper";
import { AmazonAdCategory } from "@/marketplaces/amazon/types/amazon.types";
import { ApiService } from "@/shared/backend/ApiService";
import { CronJob } from "cron";

const CATEGORY_RETRY_DELAY = 60 * 1000;

export class AmazonPlpScraper implements MarketplaceScraper {
  readonly marketplace = "amazon";

  constructor(
    private apiService = ApiService.getInstance(),
    private categoryScraper = new AmazonPlpCategoryScraper()
  ) {}

  async execute() {
    this.scrape();
    new CronJob("0 0 */1 * * *", () => this.scrape()).start();
  }

  async scrape() {
    try {
      const category = await this.apiService.get<AmazonAdCategory>(
        "amazon/ads/categories/scrap"
      );
      await this.categoryScraper.execute(category);
    } catch {
      setTimeout(() => this.scrape(), CATEGORY_RETRY_DELAY);
    }
  }
}
