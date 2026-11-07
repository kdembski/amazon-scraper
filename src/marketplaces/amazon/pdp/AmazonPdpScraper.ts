import { MarketplaceScraper } from "@/shared/interfaces/MarketplaceScraper";
import { AmazonPdpAdScraper } from "@/marketplaces/amazon/pdp/AmazonPdpAdScraper";
import { AmazonCountryService } from "@/marketplaces/amazon/AmazonCountryService";
import { AmazonAd } from "@/marketplaces/amazon/types/amazon.types";
import { ApiService } from "@/shared/backend/ApiService";
import { ScraperConfigService } from "@/shared/backend/ScraperConfigService";
import { TokenBucketQueue } from "@/shared/http/TokenBucketQueue";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { sleep } from "@/shared/utils/sleep";

const POLL_INTERVAL = 5 * 1000;
const NIGHT_START = 22;
const NIGHT_END = 8;
const TIME_ZONE = "Europe/Warsaw";

export class AmazonPdpScraper implements MarketplaceScraper {
  readonly marketplace = "amazon";
  private paused = false;

  constructor(
    private apiService = ApiService.getInstance(),
    private queueService = TokenBucketQueue.getInstance(),
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
    if (this.isNight() !== this.paused) {
      this.paused = !this.paused;
      console.log(`pdp: night pause ${this.paused ? "started" : "ended"}`);
    }
    if (this.paused) return;

    const { batchSize } = this.configService.get();
    if (this.queueService.queue.length > batchSize / 10) return;

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

  private isNight() {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: TIME_ZONE })
        .format(new Date())
    );
    return hour >= NIGHT_START || hour < NIGHT_END;
  }
}
