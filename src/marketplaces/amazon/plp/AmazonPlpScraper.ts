import { MarketplaceScraper } from "@/shared/interfaces/MarketplaceScraper";
import { AmazonPlpCategoryScraper } from "@/marketplaces/amazon/plp/AmazonPlpCategoryScraper";
import { AmazonAdCategory } from "@/marketplaces/amazon/types/amazon.types";
import { ApiService } from "@/shared/backend/ApiService";
import { sleep } from "@/shared/utils/sleep";

const CATEGORY_RETRY_DELAY = 60 * 1000;

export class AmazonPlpScraper implements MarketplaceScraper {
  readonly marketplace = "amazon";

  constructor(
    private apiService = ApiService.getInstance(),
    private categoryScraper = new AmazonPlpCategoryScraper()
  ) {}

  async execute() {
    while (true) {
      await this.scrape();
    }
  }

  async scrape() {
    try {
      const category = await this.apiService.get<AmazonAdCategory>(
        "amazon/ads/categories/scrap"
      );
      await this.categoryScraper.execute(category);
    } catch {
      await sleep(CATEGORY_RETRY_DELAY);
    }
  }
}
