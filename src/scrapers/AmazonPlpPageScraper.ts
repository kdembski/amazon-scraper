import { AmazonPlpBuilder } from "@/builders/AmazonPlpBuilder";
import { getRetryDelay, MAX_FAILED_ATTEMPTS } from "@/helpers/retry";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import { ArgsService } from "@/services/ArgsService";
import { AmazonPlpAdPage, AmazonPlpAd } from "@/types/amazon.types";
import { parseHTML } from "linkedom";

export class AmazonPlpPageScraper {
  private apiService;
  private amazonService;
  private argsService;
  private builder;
  private queueFullDelay = 1000;
  private maxPages = 10;

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
        this.execute(this.buildPage(page.category, sub, page.visited));
      });

    if (hasNextPage && page.number < this.maxPages) {
      const { category, subcategory, visited, number } = page;
      this.execute(this.buildPage(category, subcategory, visited, number + 1));
    }

    page.resolve?.(ads);
  }

  private onError(page: AmazonPlpAdPage) {
    page.reject?.("Failed");
  }

  private getUrl(page: AmazonPlpAdPage) {
    const subcategory = page.subcategory ? `&rh=${page.subcategory}` : "";
    const number = page.number > 1 ? `&page=${page.number}` : "";
    return `pl/s?i=${page.category}${subcategory}&s=date-desc-rank${number}`;
  }

  buildPage(
    category: string,
    subcategory?: string,
    visited = new Set<string>(),
    number = 1
  ): AmazonPlpAdPage {
    return {
      category,
      subcategory,
      pending: false,
      complete: false,
      failed: 0,
      visited,
      number,
    };
  }
}
