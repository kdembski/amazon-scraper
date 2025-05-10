import { AmazonPlpBuilder } from "@/builders/AmazonPlpBuilder";
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
    if (queue >= count || page.complete || page.pending) return;

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
      this.amazonService.get<string>(url, referer, callback, true);
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
        this.execute(page);
      });
  }

  private async onSuccess(data: string, page: AmazonPlpAdPage) {
    if (!data.length) {
      page.reject?.("Received empty data");
      return;
    }

    const { document } = parseHTML(data);
    const ads = this.builder.build(document, page.category);
    const subcategories = this.builder.buildSubcategories(document);

    if (ads.length === 0) {
      page.reject?.("No ads found");
      return;
    }

    subcategories.forEach((sub) => {
      const subPage = this.buildPage(page.category, sub);
      this.execute(subPage);
    });

    page.resolve?.(ads);
  }

  private onError(page: AmazonPlpAdPage) {
    if (page.failed > 200) {
      page.resolve?.();
      return;
    }

    page.failed++;
    page.reject?.("Failed");
  }

  private getUrl(page: AmazonPlpAdPage) {
    if (page.subcategory) {
      return `pl/s?i=${page.category}&rh=${page.subcategory}&s=date-desc-rank`;
    }
    return `pl/s?i=${page.category}&s=date-desc-rank`;
  }

  buildPage(category: string, subcategory?: string) {
    return {
      category,
      subcategory,
      pending: false,
      complete: false,
      failed: 0,
    };
  }
}
