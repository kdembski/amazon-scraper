import { MarketplaceScraper } from "@/shared/interfaces/MarketplaceScraper";
import { AmazonNightSchedule } from "@/marketplaces/amazon/pdp/AmazonNightSchedule";
import { AmazonPdpAdScraper } from "@/marketplaces/amazon/pdp/AmazonPdpAdScraper";
import { AmazonCountryService } from "@/marketplaces/amazon/AmazonCountryService";
import { AmazonAd } from "@/marketplaces/amazon/types/amazon.types";
import { ApiService } from "@/shared/backend/ApiService";
import { ScraperConfigService } from "@/shared/backend/ScraperConfigService";
import { TokenBucketQueue } from "@/shared/http/TokenBucketQueue";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { sleep } from "@/shared/utils/sleep";

const POLL_INTERVAL = 1000;
const QUEUE_SECONDS = 5;
const MIN_LOAD_SHARE = 4;

export class AmazonPdpScraper implements MarketplaceScraper {
  readonly marketplace = "amazon";
  private paused = false;

  constructor(
    private apiService = ApiService.getInstance(),
    private queueService = TokenBucketQueue.getInstance(),
    private adScraper = new AmazonPdpAdScraper(),
    private countryService = AmazonCountryService.getInstance(),
    private configService = ScraperConfigService.getInstance(),
    private metricsService = MetricsService.getInstance(),
    private schedule = new AmazonNightSchedule()
  ) {}

  async execute() {
    while (true) {
      await this.scrape();
      await sleep(POLL_INTERVAL);
    }
  }

  async scrape() {
    if (this.schedule.isNight() !== this.paused) {
      this.paused = !this.paused;
      console.log(`pdp: night pause ${this.paused ? "started" : "ended"}`);
    }
    if (this.paused) return;

    const { batchSize, rps, concurrency } = this.configService.get();
    const lowWater = rps ? rps * QUEUE_SECONDS : concurrency * 2;
    if (this.queueService.queue.length >= lowWater) return;

    const missing = batchSize - this.adScraper.inFlight;
    if (missing < Math.max(batchSize / MIN_LOAD_SHARE, 1)) return;

    try {
      const countries = await this.countryService.getCountries();
      const ads = await this.apiService.get<AmazonAd[]>(
        `amazon/ads/scrap?batchSize=${missing}`
      );
      this.metricsService.increment("batch_load", { outcome: ads.length ? "ok" : "empty" });
      ads.forEach((ad) => this.adScraper.execute(ad, countries));
    } catch (e) {
      this.metricsService.increment("batch_load", { outcome: "failed" });
      console.error("pdp: batch load failed", e);
    }
  }
}
