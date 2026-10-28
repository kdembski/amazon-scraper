import { AmazonNewReleasesBuilder } from "@/marketplaces/amazon/plp/AmazonNewReleasesBuilder";
import { AmazonPlpCrawl } from "@/marketplaces/amazon/plp/AmazonPlpCrawl";
import { AmazonPlpPageFetcher } from "@/marketplaces/amazon/plp/AmazonPlpPageFetcher";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { ItemOutcome } from "@/shared/metrics/metrics.types";

export class AmazonNewReleasesScraper {
  constructor(
    private fetcher = new AmazonPlpPageFetcher(),
    private builder = new AmazonNewReleasesBuilder(),
    private metricsService = MetricsService.getInstance()
  ) {}

  execute(crawl: AmazonPlpCrawl) {
    return this.scrapeNode(crawl, new Set());
  }

  private async scrapeNode(crawl: AmazonPlpCrawl, nodes: Set<string>, node?: string) {
    const page = await this.scrapePage(crawl, node, 1);
    if (!page) return;

    const children = page.nodes.filter((child) => !nodes.has(child));
    children.forEach((child) => nodes.add(child));

    await Promise.all([
      ...children.map((child) => this.scrapeNode(crawl, nodes, child)),
      page.hasNextPage && this.scrapePage(crawl, node, 2),
    ]);
  }

  private async scrapePage(crawl: AmazonPlpCrawl, node: string | undefined, number: number) {
    const path = `pl/gp/new-releases/${crawl.category}${node ? `/${node}` : ""}`;
    const url = number > 1 ? `${path}?pg=${number}` : path;

    const { page } = await this.fetcher.fetch(url, path, (document) =>
      this.builder.build(document, crawl.category)
    );
    if (!page) {
      this.countPage("given_up");
      return;
    }

    this.countPage("data");
    this.metricsService.increment("new_releases_ads", { country: "pl" }, crawl.post(page.ads));
    return page;
  }

  private countPage(outcome: ItemOutcome) {
    this.metricsService.increment("new_releases_pages", { country: "pl", outcome });
  }
}
