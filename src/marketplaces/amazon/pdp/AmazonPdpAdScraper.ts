import { AmazonAdPrices } from "@/marketplaces/amazon/pdp/AmazonAdPrices";
import { AmazonCountryPrice } from "@/marketplaces/amazon/pdp/AmazonCountryPrice";
import { AmazonPdpCountryScraper } from "@/marketplaces/amazon/pdp/AmazonPdpCountryScraper";
import { AmazonAd, AmazonCountry } from "@/marketplaces/amazon/types/amazon.types";
import { AmazonPdpResultSender } from "@/marketplaces/amazon/pdp/AmazonPdpResultSender";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { AdOutcome, ItemOutcome } from "@/shared/metrics/metrics.types";

export class AmazonPdpAdScraper {
  private inFlight = 0;

  constructor(
    private countryScraper = new AmazonPdpCountryScraper(),
    private resultSender = AmazonPdpResultSender.getInstance(),
    private metricsService = MetricsService.getInstance()
  ) {
    metricsService.gauge("ads_in_flight", () => this.inFlight);
  }

  execute(ad: AmazonAd, countries: AmazonCountry[]) {
    const prices = new AmazonAdPrices(
      countries
        .filter((country) => !ad.skipCountryIds?.includes(country.countryId))
        .map((country) => new AmazonCountryPrice(country))
    );
    if (prices.isEmpty) {
      this.metricsService.increment("ads", { outcome: "empty" });
      return Promise.resolve();
    }

    const startedAt = Date.now();
    let isDone = false;
    const isCancelled = () => isDone;
    this.inFlight++;

    return new Promise<void>((resolve) => {
      const scrapeCountry = async (price: AmazonCountryPrice) => {
        const outcome = await this.countryScraper.execute(price, ad, isCancelled);
        if (!outcome || isDone) return;
        const adOutcome = this.applyOutcome(price, outcome, prices, ad);
        if (!adOutcome) return;

        isDone = true;
        this.inFlight--;
        this.metricsService.increment("ads", { outcome: adOutcome });
        this.metricsService.increment("ad_duration_ms", {}, Date.now() - startedAt);
        resolve();
      };

      this.scrapeTiers(prices.tiers(), scrapeCountry, isCancelled);
    });
  }

  private async scrapeTiers(
    tiers: AmazonCountryPrice[][],
    scrapeCountry: (price: AmazonCountryPrice) => Promise<void>,
    isCancelled: () => boolean
  ) {
    for (const tier of tiers) {
      await Promise.all(tier.map(scrapeCountry));
      if (isCancelled()) return;
    }
  }

  // The outcome of the ad once it is decided
  private applyOutcome(
    price: AmazonCountryPrice,
    outcome: ItemOutcome,
    prices: AmazonAdPrices,
    ad: AmazonAd
  ): AdOutcome | undefined {
    price.finish(outcome);

    if (prices.isDeleted) {
      this.resultSender.deleted(ad.id);
      return "deleted";
    }

    if (!prices.isDecided) return;

    const result = prices.toResult(ad.id);
    this.resultSender.prices(ad.id, result.prices, result.missingCountryIds);
    return result.prices.length ? "prices" : "empty";
  }
}
