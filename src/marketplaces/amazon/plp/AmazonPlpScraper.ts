import { AmazonPlpPageScraper } from "@/marketplaces/amazon/plp/AmazonPlpPageScraper";
import { AmazonAdCategory } from "@/marketplaces/amazon/types/amazon.types";

export class AmazonPlpScraper {
  private pageScraper;

  constructor(pageScraper = new AmazonPlpPageScraper()) {
    this.pageScraper = pageScraper;
  }

  execute(category: AmazonAdCategory) {
    this.pageScraper.executeCategory(category.name, !category.scrapedAt);
  }
}
