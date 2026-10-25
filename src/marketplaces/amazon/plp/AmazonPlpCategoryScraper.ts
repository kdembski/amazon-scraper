import { AmazonNewReleasesScraper } from "@/marketplaces/amazon/plp/AmazonNewReleasesScraper";
import { AmazonPlpPageScraper } from "@/marketplaces/amazon/plp/AmazonPlpPageScraper";
import { AmazonAdCategory } from "@/marketplaces/amazon/types/amazon.types";

export class AmazonPlpCategoryScraper {
  private pageScraper;
  private newReleasesScraper;

  constructor(
    pageScraper = new AmazonPlpPageScraper(),
    newReleasesScraper = new AmazonNewReleasesScraper()
  ) {
    this.pageScraper = pageScraper;
    this.newReleasesScraper = newReleasesScraper;
  }

  async execute(category: AmazonAdCategory) {
    await this.newReleasesScraper.execute(category.name);
    this.pageScraper.executeCategory(category.name, !category.scrapedAt);
  }
}
