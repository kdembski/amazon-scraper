import { AmazonPlpAdBuilder } from "@/builders/AmazonPlpAdBuilder";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import {
  AmazonPlpAdPage,
  AmazonPlpAd,
  AmazonPlpAdPageSort,
} from "@/types/amazon.types";
import { parseHTML } from "linkedom";
import lodash from "lodash";

export class AmazonPlpScraper {
  private baseUrl = "https://www.amazon.pl/";
  private apiService;
  private amazonService;
  private builder;
  private category: string;
  private pages: AmazonPlpAdPage[];
  private ranges = [
    { min: 0, max: 5 },
    { min: 5, max: 10 },
    { min: 10, max: 20 },
    { min: 20, max: 30 },
    { min: 30, max: 40 },
    { min: 40, max: 50 },
    { min: 50, max: 75 },
    { min: 75, max: 100 },
    { min: 100, max: 150 },
    { min: 150, max: 300 },
    { min: 300, max: 500 },
    { min: 500, max: 1000 },
    { min: 1000 },
  ];

  constructor(
    category: string,
    pages: number | number[],
    apiService = ApiService.getInstance(),
    amazonService = AmazonService.getInstance(),
    builder = new AmazonPlpAdBuilder()
  ) {
    this.category = category;
    this.apiService = apiService;
    this.amazonService = amazonService;
    this.builder = builder;

    if (lodash.isArray(pages)) {
      this.pages = pages.flatMap((number) =>
        this.ranges.map((range) => this.buildPage(number, range))
      );
      return;
    }

    this.pages = new Array(pages)
      .fill(null)
      .flatMap((_, i) =>
        this.ranges.map((range) => this.buildPage(i + 1, range))
      );
  }

  execute() {
    return this.pages.map(
      (page) =>
        new Promise<void>((resolve) => {
          this.handlePage(page, resolve);
        })
    );
  }

  private buildPage(number: number, range: AmazonPlpAdPageSort) {
    return {
      number,
      range,
      pending: false,
      complete: false,
      failed: 0,
    };
  }

  private handlePage(page: AmazonPlpAdPage, resolve: () => void) {
    const ref = Math.floor(Math.random() * 100000000000);
    const referer = `${this.baseUrl}b?node=${ref}`;
    const url = `${this.baseUrl}s?i=${this.category}&page=${page.number}&low-price=${page.range.min}&high-price=${page.range.max}`;

    if (page.complete || page.pending) return;
    page.pending = true;

    this.amazonService.get<string>(
      url,
      referer,
      {
        onSuccess: (res) => this.onSuccess(res, page, resolve),
        onError: () => this.onError(page, resolve),
      },
      true
    );
  }

  private async onSuccess(
    data: string,
    page: AmazonPlpAdPage,
    resolve: () => void
  ) {
    const listItemSelector = "div[role='listitem']";
    const { document } = parseHTML(data);
    const items = [...document.querySelectorAll(listItemSelector)];

    const ads = items.reduce((accum: AmazonPlpAd[], item) => {
      const ad = this.builder.build(item, this.category);
      if (!ad) return accum;

      accum.push(ad);
      return accum;
    }, []);

    if (ads.length === 0) {
      page.pending = false;
      this.handlePage(page, resolve);
      return;
    }

    page.complete = true;
    console.log(`Collected ${ads.length} ads from '${this.category}'`);
    await this.apiService.post("amazon/ads", ads);

    resolve();
  }

  private onError(page: AmazonPlpAdPage, resolve: () => void) {
    page.pending = false;

    if (page.failed > 100) {
      page.complete = true;
      resolve();
      return;
    }

    page.failed++;
    this.handlePage(page, resolve);
  }
}
