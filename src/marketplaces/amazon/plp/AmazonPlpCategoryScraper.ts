import { AmazonNewReleasesScraper } from "@/marketplaces/amazon/plp/AmazonNewReleasesScraper";
import { AmazonPlpCrawl } from "@/marketplaces/amazon/plp/AmazonPlpCrawl";
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
    const crawl = new AmazonPlpCrawl(category.name, !category.scrapedAt);
    await this.newReleasesScraper.execute(crawl);
    await this.pageScraper.execute(crawl);
  }
}
