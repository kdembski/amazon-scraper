import { AmazonPlpBuilder } from "@/builders/AmazonPlpBuilder";
import { getRetryDelay, MAX_FAILED_ATTEMPTS } from "@/helpers/retry";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import { ArgsService } from "@/services/ArgsService";
import { AmazonPlpAdPage, AmazonPlpAd } from "@/types/amazon.types";
import { parseHTML } from "linkedom";
import _ from "lodash";

export class AmazonPlpPageScraper {
  private apiService;
  private amazonService;
  private argsService;
  private builder;
  private queueFullDelay = 1000;
  private maxPages = 10;
  // Amazon price filter (p_36) in grosze
  private priceRanges = [
    "-1999",
    "2000-4999",
    "5000-9999",
    "10000-19999",
    "20000-49999",
    "50000-99999",
    "100000-",
  ];

  constructor(
    apiService = ApiService.getInstance(),
    amazonService = AmazonService.getInstance(),
    argsService = ArgsService.getInstance(),
    builder = new AmazonPlpBuilder()
  ) {
    this.apiService = apiService;
    this.amazonService = amazonService;
    this.argsService = argsService;
    this.builder = builder;
  }

  executeCategory(
    category: string,
    subcategory?: string,
    visited = new Set<string>()
  ) {
    this.priceRanges.forEach((price) => {
      this.execute(this.buildPage(category, subcategory, visited, 1, price));
    });
  }

  async execute(page: AmazonPlpAdPage) {
    const count = this.argsService.getCountFlag();
    const queue = this.amazonService.queueService.queue.length;
    if (page.complete || page.pending) return;

    if (queue >= count) {
      setTimeout(() => this.execute(page), this.queueFullDelay);
      return;
    }

    return new Promise<AmazonPlpAd[] | undefined>((resolve, reject) => {
      page.resolve = resolve;
      page.reject = reject;

      const url = this.getUrl(page);
      const ref = Math.floor(Math.random() * 100000000000);
      const referer = `pl/b?node=${ref}`;

      page.pending = true;

      const callback = {
        onSuccess: (res: string) => this.onSuccess(res, page),
        onError: () => this.onError(page),
      };
      this.amazonService.get<string>(url, referer, callback);
    })
      .then((ads) => {
        page.pending = false;
        page.complete = true;
        this.amazonService.queueService.completed++;
        if (ads) this.apiService.post("amazon/ads", ads);
      })
      .catch(() => {
        page.pending = false;
        page.failed++;
        this.amazonService.queueService.failed++;
        this.retry(page);
      });
  }

  private retry(page: AmazonPlpAdPage) {
    if (page.failed >= MAX_FAILED_ATTEMPTS) {
      page.complete = true;
      return;
    }

    setTimeout(() => this.execute(page), getRetryDelay(page.failed));
  }

  private async onSuccess(data: string, page: AmazonPlpAdPage) {
    if (!data.length) {
      page.reject?.("Received empty data");
      return;
    }

    const { document } = parseHTML(data);
    const { ads, subcategories, hasNextPage } = this.builder.build(
      document,
      page.category
    );

    if (ads.length === 0) {
      page.reject?.("No ads found");
      return;
    }

    subcategories
      .filter((sub) => !page.visited.has(sub))
      .forEach((sub) => {
        page.visited.add(sub);
        this.executeCategory(page.category, sub, page.visited);
      });

    if (hasNextPage && page.number < this.maxPages) {
      const { category, subcategory, visited, number, price } = page;
      this.execute(
        this.buildPage(category, subcategory, visited, number + 1, price)
      );
    }

    page.resolve?.(ads);
  }

  private onError(page: AmazonPlpAdPage) {
    page.reject?.("Failed");
  }

  private getUrl(page: AmazonPlpAdPage) {
    const price = page.price && `p_36%3A${page.price}`;
    const filters = _.compact([page.subcategory, price]).join("%2C");
    const rh = filters ? `&rh=${filters}` : "";
    const number = page.number > 1 ? `&page=${page.number}` : "";
    return `pl/s?i=${page.category}${rh}&s=date-desc-rank${number}`;
  }

  buildPage(
    category: string,
    subcategory?: string,
    visited = new Set<string>(),
    number = 1,
    price?: string
  ): AmazonPlpAdPage {
    return {
      category,
      subcategory,
      pending: false,
      complete: false,
      failed: 0,
      visited,
      number,
      price,
    };
  }
}
