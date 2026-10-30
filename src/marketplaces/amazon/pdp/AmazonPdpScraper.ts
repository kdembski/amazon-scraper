import { MarketplaceScraper } from "@/shared/interfaces/MarketplaceScraper";
import { AmazonPdpAdScraper } from "@/marketplaces/amazon/pdp/AmazonPdpAdScraper";
import { AmazonService } from "@/marketplaces/amazon/AmazonService";
import { AmazonCountryService } from "@/marketplaces/amazon/AmazonCountryService";
import { AmazonAd } from "@/marketplaces/amazon/types/amazon.types";
import { ApiService } from "@/shared/backend/ApiService";
import { ScraperConfigService } from "@/shared/backend/ScraperConfigService";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { sleep } from "@/shared/utils/sleep";

const POLL_INTERVAL = 5 * 1000;

export class AmazonPdpScraper implements MarketplaceScraper {
  readonly marketplace = "amazon";

  constructor(
    private apiService = ApiService.getInstance(),
    private amazonService = AmazonService.getInstance(),
    private adScraper = new AmazonPdpAdScraper(),
    private countryService = AmazonCountryService.getInstance(),
    private configService = ScraperConfigService.getInstance(),
    private metricsService = MetricsService.getInstance()
  ) {}

  async execute() {
    while (true) {
      await this.scrape();
      await sleep(POLL_INTERVAL);
    }
  }

  async scrape() {
    const { batchSize } = this.configService.get();
    if (this.amazonService.queueService.queue.length > batchSize / 10) return;

    try {
      const countries = await this.countryService.getCountries();
      const ads = await this.apiService.get<AmazonAd[]>(
        `amazon/ads/scrap?batchSize=${batchSize}`
      );
      this.metricsService.increment("batch_load", { outcome: ads.length ? "ok" : "empty" });
      ads.forEach((ad) => this.adScraper.execute(ad, countries));
    } catch (e) {
      this.metricsService.increment("batch_load", { outcome: "failed" });
      console.error("pdp: batch load failed", e);
    }
  }
}
