import { AmazonNewReleasesScraper } from "@/marketplaces/amazon/plp/AmazonNewReleasesScraper";
import { AmazonPlpCrawl } from "@/marketplaces/amazon/plp/AmazonPlpCrawl";
import { AmazonPlpPageScraper } from "@/marketplaces/amazon/plp/AmazonPlpPageScraper";
import { AmazonAdCategory } from "@/marketplaces/amazon/types/amazon.types";

export class AmazonPlpCategoryScraper {
  constructor(
    private pageScraper = new AmazonPlpPageScraper(),
    private newReleasesScraper = new AmazonNewReleasesScraper()
  ) {}

  async execute(category: AmazonAdCategory) {
    const crawl = new AmazonPlpCrawl(category.name, !category.scrapedAt);
    await this.newReleasesScraper.execute(crawl);
    await this.pageScraper.execute(crawl);
  }
}
