import { AmazonPlpBuilder } from "@/builders/AmazonPlpBuilder";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import { AmazonPlpAdPage, AmazonPlpAd } from "@/types/amazon.types";
import { parseHTML } from "linkedom";

export class AmazonPlpPageScraper {
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

  async execute(page: AmazonPlpAdPage, category: string) {
    return new Promise<AmazonPlpAd[] | undefined>((resolve, reject) => {
      page.resolve = resolve;
      page.reject = reject;

      const url = this.getUrl(page, category);
      const ref = Math.floor(Math.random() * 100000000000);
      const referer = `pl/b?node=${ref}`;

      if (page.complete || page.pending) return;
      page.pending = true;

      const callback = {
        onSuccess: (res: string) => this.onSuccess(res, page, category),
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
        this.execute(page, category);
      });
  }

  private async onSuccess(
    data: string,
    page: AmazonPlpAdPage,
    category: string
  ) {
    const { document } = parseHTML(data);
    const ads = this.builder.build(document, category);

    if (ads.length === 0) {
      page.reject?.("No ads found");
      return;
    }

    page.resolve?.(ads);
  }

  private onError(page: AmazonPlpAdPage) {
    if (page.failed > 100) {
      page.resolve?.();
      return;
    }

    page.failed++;
    page.reject?.("Failed");
  }

  private getUrl(page: AmazonPlpAdPage, category: string) {
    return `pl/s?i=${category}&rh=${page.subcategory}&page=${page.number}&low-price=${page.range.min}&high-price=${page.range.max}`;
  }
}
