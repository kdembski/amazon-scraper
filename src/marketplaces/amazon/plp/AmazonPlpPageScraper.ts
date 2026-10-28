import { AmazonPlpBuilder } from "@/marketplaces/amazon/plp/AmazonPlpBuilder";
import { AmazonPlpCrawl } from "@/marketplaces/amazon/plp/AmazonPlpCrawl";
import { AmazonPlpPageFetcher } from "@/marketplaces/amazon/plp/AmazonPlpPageFetcher";
import {
  parsePriceRange,
  PriceRange,
  splitPriceRange,
  toPriceFilter,
} from "@/marketplaces/amazon/plp/AmazonPlpPriceRange";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { ItemOutcome } from "@/shared/metrics/metrics.types";

// Amazon shows at most this many pages of a search, a range with as many is cut off
const MAX_PAGES = 400;

const SEEDS = [
  "-999",
  "1000-1999",
  "2000-2999",
  "3000-3999",
  "4000-4999",
  "5000-7499",
  "7500-9999",
  "10000-14999",
  "15000-19999",
  "20000-29999",
  "30000-39999",
  "40000-49999",
  "50000-74999",
  "75000-99999",
  "100000-149999",
  "150000-199999",
  "200000-299999",
  "300000-499999",
  "500000-",
].map(parsePriceRange);

export class AmazonPlpPageScraper {
  constructor(
    private fetcher = new AmazonPlpPageFetcher(),
    private builder = new AmazonPlpBuilder(),
    private metricsService = MetricsService.getInstance()
  ) {}

  async execute(crawl: AmazonPlpCrawl) {
    await Promise.all(SEEDS.map((range) => this.scrapeRange(crawl, range)));
  }

  private async scrapeRange(crawl: AmazonPlpCrawl, range: PriceRange) {
    const first = await this.scrapePage(crawl, range, 1);
    if (!first) return;

    const halves = first.lastPage >= MAX_PAGES ? splitPriceRange(range) : undefined;
    if (halves) {
      await Promise.all(halves.map((half) => this.scrapeRange(crawl, half)));
      return;
    }

    if (!crawl.allPages) return;
    for (let number = 2; number <= first.lastPage; number++) {
      if (!(await this.scrapePage(crawl, range, number))) return;
    }
  }

  private async scrapePage(crawl: AmazonPlpCrawl, range: PriceRange, number: number) {
    const page = number > 1 ? `&page=${number}` : "";
    const url = `pl/s?i=${crawl.category}&rh=${toPriceFilter(range)}&s=date-desc-rank${page}`;
    const referer = `pl/b?node=${Math.floor(Math.random() * 100000000000)}`;

    const result = await this.fetcher.fetch(url, referer, (document) =>
      this.builder.build(document, crawl.category)
    );
    if (!result.page) {
      this.countItem("given_up", result.failed);
      return;
    }

    this.countItem(result.page.ads.length ? "data" : "no_data", result.failed + 1);
    crawl.post(result.page.ads);
    return result.page;
  }

  private countItem(outcome: ItemOutcome, attempts: number) {
    const labels = { country: "pl", outcome };
    this.metricsService.increment("items", labels);
    this.metricsService.increment("item_attempts", labels, attempts);
  }
}
