import { AmazonPlpPageScraper } from "@/scrapers/amazon/AmazonPlpPageScraper";
import { AmazonPlpAdPage } from "@/types/amazon.types";

export class AmazonPlpScraper {
  private pageScraper;

  constructor(pageScraper = new AmazonPlpPageScraper()) {
    this.pageScraper = pageScraper;
  }

  execute(category: string) {
    const pages: AmazonPlpAdPage[] = [];
    this.pageScraper.execute(pages, category);
  }
}
