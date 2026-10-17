import { AmazonPlpPageScraper } from "@/scrapers/AmazonPlpPageScraper";

export class AmazonPlpScraper {
  private pageScraper;

  constructor(pageScraper = new AmazonPlpPageScraper()) {
    this.pageScraper = pageScraper;
  }

  execute(category: string) {
    const page = this.pageScraper.buildPage(category);
    this.pageScraper.execute(page);
  }
}
