import { AmazonPlpAdBuilder } from "@/builders/AmazonPlpAdBuilder";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import { AmazonPlpAdPage, AmazonPlpAd } from "@/types/amazon.types";
import { parseHTML } from "linkedom";
import lodash from "lodash";

export class AmazonPlpScraper {
  private baseUrl = "https://www.amazon.pl/";
  private apiService;
  private amazonService;
  private category: string;
  private pages: AmazonPlpAdPage[];
  private sorts = [
    "exact-aware-popularity-rank",
    "date-desc-rank",
    "review-rank",
  ];

  constructor(
    category: string,
    pages: number | number[],
    apiService = ApiService.getInstance(),
    amazonService = AmazonService.getInstance()
  ) {
    this.category = category;
    this.apiService = apiService;
    this.amazonService = amazonService;

    if (lodash.isArray(pages)) {
      this.pages = pages.flatMap((number) =>
        this.sorts.map((sort) => this.buildPage(number, sort))
      );
      return;
    }

    this.pages = new Array(pages)
      .fill(null)
      .flatMap((_, i) => this.sorts.map((sort) => this.buildPage(i, sort)));
  }

  execute() {
    console.log(this.category);
    return this.pages.map(
      (page) =>
        new Promise<void>((resolve) => {
          this.handlePage(page, resolve);
        })
    );
  }

  private buildPage(number: number, sort: string) {
    return {
      number,
      sort,
      pending: false,
      complete: false,
    };
  }

  private handlePage(page: AmazonPlpAdPage, resolve: () => void) {
    const ref = Math.floor(Math.random() * 100000000000);
    const referer = `${this.baseUrl}b?node=${ref}`;
    const url = `${this.baseUrl}s?i=${this.category}&rh=n%3A${ref}&s=${page.sort}&page=${page.number}&fs=true&ref=lp_${ref}_sar`;

    if (page.complete || page.pending) return;
    page.pending = true;

    this.amazonService.get<string>(url, referer, {
      onSuccess: (data) => this.onSuccess(data, page, resolve),
      onError: () => this.onError(page, resolve),
    });
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
      const ad = new AmazonPlpAdBuilder().build(item, this.category).ad;
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
    await this.apiService.post("amazon/ads", ads);
    console.log(`Collected ${ads.length} ads from '${this.category}'`);
    resolve();
  }

  private onError(page: AmazonPlpAdPage, resolve: () => void) {
    page.pending = false;
    this.handlePage(page, resolve);
  }
}
