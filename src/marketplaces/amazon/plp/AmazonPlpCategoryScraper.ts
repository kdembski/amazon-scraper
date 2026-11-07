import { AmazonPlpCrawl } from "@/marketplaces/amazon/plp/AmazonPlpCrawl";
import { AmazonPlpPageScraper } from "@/marketplaces/amazon/plp/AmazonPlpPageScraper";
import { AmazonAdCategory } from "@/marketplaces/amazon/types/amazon.types";

export class AmazonPlpCategoryScraper {
  constructor(private pageScraper = new AmazonPlpPageScraper()) {}

  async execute(category: AmazonAdCategory) {
    const crawl = new AmazonPlpCrawl(category.name, !category.scrapedAt);
    await this.pageScraper.execute(crawl);
  }
}
