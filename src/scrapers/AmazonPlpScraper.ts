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
    apiService = ApiService.getInstance(),
    amazonService = AmazonService.getInstance(),
    builder = new AmazonPlpAdBuilder()
  ) {
    this.apiService = apiService;
    this.amazonService = amazonService;
    this.builder = builder;
  }

  execute(category: string, length: number | number[]) {
    const pages = this.buildPages(length);
    return pages.map(
      (page) =>
        new Promise<void>((resolve) => {
          this.handlePage(page, category, resolve);
        })
    );
  }

  private buildPages(length: number | number[]) {
    if (lodash.isArray(length)) {
      return length.flatMap((number) =>
        this.ranges.map((range) => this.buildPage(number, range))
      );
    }

    return new Array(length)
      .fill(null)
      .flatMap((_, i) =>
        this.ranges.map((range) => this.buildPage(i + 1, range))
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

  private handlePage(
    page: AmazonPlpAdPage,
    category: string,
    resolve: () => void
  ) {
    const ref = Math.floor(Math.random() * 100000000000);
    const referer = `${this.baseUrl}b?node=${ref}`;
    const url = `${this.baseUrl}s?i=${category}&page=${page.number}&low-price=${page.range.min}&high-price=${page.range.max}`;

    if (page.complete || page.pending) return;
    page.pending = true;

    this.amazonService.get<string>(
      url,
      referer,
      {
        onSuccess: (res) => this.onSuccess(res, page, category, resolve),
        onError: () => this.onError(page, category, resolve),
      },
      true
    );
  }

  private async onSuccess(
    data: string,
    page: AmazonPlpAdPage,
    category: string,
    resolve: () => void
  ) {
    page.pending = false;

    const { document } = parseHTML(data);
    const ads = this.buildAds(document, category);

    if (ads.length === 0) {
      this.retry(page, category, resolve);
      return;
    }

    this.complete(page, ads, resolve);
  }

  private buildAds(document: Document, category: string) {
    const listItemSelector = "div[role='listitem']";
    const items = [...document.querySelectorAll(listItemSelector)];

    return items.reduce((accum: AmazonPlpAd[], item) => {
      const ad = this.builder.build(item, category);
      if (!ad) return accum;

      accum.push(ad);
      return accum;
    }, []);
  }

  private onError(
    page: AmazonPlpAdPage,
    category: string,
    resolve: () => void
  ) {
    page.pending = false;

    if (page.failed > 100) {
      page.complete = true;
      resolve();
      return;
    }

    page.failed++;
    this.retry(page, category, resolve);
  }

  private retry(page: AmazonPlpAdPage, category: string, resolve: () => void) {
    this.handlePage(page, category, resolve);
  }

  private complete(
    page: AmazonPlpAdPage,
    ads: AmazonPlpAd[],
    resolve: () => void
  ) {
    page.complete = true;
    this.apiService.post("amazon/ads", ads);
    resolve();
  }
}
