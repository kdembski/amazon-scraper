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
    { min: 0, max: 10 },
    { min: 10, max: 25 },
    { min: 25, max: 50 },
    { min: 50, max: 100 },
    { min: 100, max: 200 },
    { min: 200, max: 500 },
    { min: 500, max: 1000 },
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

  async execute(category: string, length: number) {
    const subcategories = await this.loadSubcategories(category);
    const pages = this.buildPages(subcategories, length);

    const promises = pages.map((page) =>
      this.pageScraper.execute(page, category)
    );
    await Promise.all(promises);
  }

  private buildPages(subcategories: string[], length: number) {
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

  private async loadSubcategories(category: string) {
    const subcategories = await new Promise<string[]>((resolve) =>
      this.intervalLoadSubcategories(category, resolve)
    );

    const promises = subcategories.map(async (subcategory) => {
      const subsubcategories = await new Promise<string[]>((resolve) =>
        this.intervalLoadSubcategories(category, resolve, subcategory)
      );
      subcategories.push(...subsubcategories);
    });

    await Promise.all(promises);

    return [...new Set(subcategories)];
  }

  private intervalLoadSubcategories(
    category: string,
    resolve: (value: string[]) => void,
    subcategory?: string
  ) {
    const url = subcategory
      ? `pl/s?i=${category}&rh=${subcategory}&s=popularity-rank`
      : `pl/s?i=${category}&s=popularity-rank`;

    this.amazonService.get<string>(
      url,
      "pl/",
      {
        onSuccess: (data) => {
          if (!data.length) {
            this.intervalLoadSubcategories(category, resolve, subcategory);
            return;
          }

          const { document } = parseHTML(data);
          const subcategories = this.builder.buildSubcategories(document);

          if (!subcategories.length) {
            this.intervalLoadSubcategories(category, resolve, subcategory);
            return;
          }

          resolve(subcategories);
        },
        onError: () => {
          this.intervalLoadSubcategories(category, resolve, subcategory);
        },
      },
      true
    );
  }
}
