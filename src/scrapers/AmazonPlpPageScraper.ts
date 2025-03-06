import { AmazonPlpBuilder } from "@/builders/AmazonPlpBuilder";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import { AmazonPlpAdPage, AmazonPlpAd } from "@/types/amazon.types";
import { parseHTML } from "linkedom";

export class AmazonPlpPageScraper {
  private baseUrl = "https://www.amazon.pl/";
  private apiService;
  private amazonService;
  private builder;

  constructor(
    apiService = ApiService.getInstance(),
    amazonService = AmazonService.getInstance(),
    builder = new AmazonPlpBuilder()
  ) {
    this.apiService = apiService;
    this.amazonService = amazonService;
    this.builder = builder;
  }

  execute(page: AmazonPlpAdPage, category: string, resolve: () => void) {
    const ref = Math.floor(Math.random() * 100000000000);
    const referer = `${this.baseUrl}b?node=${ref}`;
    const url = `${this.baseUrl}s?i=${category}&rh=${page.subcategory}&page=${page.number}&low-price=${page.range.min}&high-price=${page.range.max}`;

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
    const ads = this.builder.build(document, category);

    if (ads.length === 0) {
      this.retry(page, category, resolve);
      return;
    }

    this.complete(page, ads, resolve);
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
    this.execute(page, category, resolve);
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
