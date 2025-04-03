import { AmazonPlpBuilder } from "@/builders/AmazonPlpBuilder";
import { AmazonPlpPageScraper } from "@/scrapers/amazon/AmazonPlpPageScraper";
import { AmazonService } from "@/services/AmazonService";
import { AmazonPlpAdPageSort } from "@/types/amazon.types";
import { parseHTML } from "linkedom";

export class AmazonPlpScraper {
  private pageScraper;
  private amazonService;
  private builder;
  private ranges = [
    { min: 0, max: 50 },
    { min: 50, max: 200 },
    { min: 200, max: 1000 },
    { min: 1000 },
  ];

  constructor(
    pageScraper = new AmazonPlpPageScraper(),
    amazonService = AmazonService.getInstance(),
    builder = new AmazonPlpBuilder()
  ) {
    this.pageScraper = pageScraper;
    this.amazonService = amazonService;
    this.builder = builder;
  }

  async execute(category: string) {
    const subcategories = await new Promise<string[]>((resolve) =>
      this.loadSubcategories(category, resolve)
    );
    const pages = this.buildPages(subcategories);
    pages.length = Math.min(pages.length, 60 * 60);

    const promises = pages.map((page) =>
      this.pageScraper.execute(page, category)
    );
    await Promise.all(promises);
  }

  private buildPages(subcategories: string[]) {
    const length = 400;

    return new Array(length)
      .fill(null)
      .flatMap((_, i) =>
        subcategories.flatMap((sub) =>
          this.ranges.map((range) => this.buildPage(i + 1, range, sub))
        )
      );
  }

  private buildPage(
    number: number,
    range: AmazonPlpAdPageSort,
    subcategory: string
  ) {
    return {
      number,
      range,
      subcategory,
      pending: false,
      complete: false,
      failed: 0,
    };
  }

  loadSubcategories(category: string, resolve: (value: string[]) => void) {
    const url = `pl/s?i=${category}&s=popularity-rank`;

    this.amazonService.get<string>(
      url,
      "pl/",
      {
        onSuccess: (data) => {
          if (!data.length) {
            this.loadSubcategories(category, resolve);
            return;
          }

          const { document } = parseHTML(data);
          const subcategories = this.builder.buildSubcategories(document);

          if (!subcategories.length) {
            this.loadSubcategories(category, resolve);
            return;
          }

          resolve(subcategories);
        },
        onError: () => {
          this.loadSubcategories(category, resolve);
        },
      },
      true
    );
  }
}
