import { AmazonService } from "@/marketplaces/amazon/AmazonService";
import { AmazonNewReleasesBuilder } from "@/marketplaces/amazon/plp/AmazonNewReleasesBuilder";
import { ScraperConfigService } from "@/shared/backend/ScraperConfigService";
import { ApiService } from "@/shared/backend/ApiService";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { ItemOutcome } from "@/shared/metrics/metrics.types";
import { getRetryDelay, MAX_FAILED_ATTEMPTS } from "@/shared/utils/retry";
import { sleep } from "@/shared/utils/sleep";
import { parseDocument } from "htmlparser2";

type Crawl = { category: string; nodes: Set<string>; asins: Set<string> };

export class AmazonNewReleasesScraper {
  private apiService;
  private amazonService;
  private configService;
  private builder;
  private queueFullDelay = 1000;
  private metricsService;

  constructor(
    apiService = ApiService.getInstance(),
    amazonService = AmazonService.getInstance(),
    configService = ScraperConfigService.getInstance(),
    builder = new AmazonNewReleasesBuilder(),
    metricsService = MetricsService.getInstance()
  ) {
    this.apiService = apiService;
    this.amazonService = amazonService;
    this.configService = configService;
    this.builder = builder;
    this.metricsService = metricsService;
  }

  execute(category: string) {
    return this.scrapeNode({ category, nodes: new Set(), asins: new Set() });
  }

  private async scrapeNode(crawl: Crawl, node?: string) {
    const page = await this.scrapePage(crawl, node, 1);
    if (!page) return;

    const children = page.nodes.filter((child) => !crawl.nodes.has(child));
    children.forEach((child) => crawl.nodes.add(child));

    await Promise.all([
      ...children.map((child) => this.scrapeNode(crawl, child)),
      page.hasNextPage && this.scrapePage(crawl, node, 2),
    ]);
  }

  private async scrapePage(crawl: Crawl, node: string | undefined, number: number) {
    const path = `pl/gp/new-releases/${crawl.category}${node ? `/${node}` : ""}`;
    const url = number > 1 ? `${path}?pg=${number}` : path;

    for (let failed = 0; failed < MAX_FAILED_ATTEMPTS; failed++) {
      if (failed) await sleep(getRetryDelay(failed));

      const page = await this.fetch(url, path)
        .then((html) => this.builder.build(this.parse(html), crawl.category))
        .catch(() => undefined);
      if (!page?.isValid) continue;

      const ads = page.ads.filter((ad) => !crawl.asins.has(ad.asin));
      ads.forEach((ad) => crawl.asins.add(ad.asin));
      if (ads.length) this.apiService.post("amazon/ads", ads);

      this.countPage("data");
      this.metricsService.increment("new_releases_ads", { country: "pl" }, ads.length);
      return page;
    }

    this.countPage("given_up");
  }

  private async fetch(url: string, referer: string) {
    const { batchSize } = this.configService.get();
    while (this.amazonService.queueService.queue.length >= batchSize) {
      await sleep(this.queueFullDelay);
    }

    return new Promise<string>((resolve, reject) =>
      this.amazonService.get<string>(url, referer, {
        onSuccess: resolve,
        onError: reject,
      })
    );
  }

  private parse(html: string) {
    return parseDocument(html);
  }

  private countPage(outcome: ItemOutcome) {
    this.metricsService.increment("new_releases_pages", { country: "pl", outcome });
  }
}
