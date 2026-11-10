import { AmazonAdPrices } from "@/marketplaces/amazon/pdp/AmazonAdPrices";
import { AmazonCountryPrice } from "@/marketplaces/amazon/pdp/AmazonCountryPrice";
import { AmazonPdpCountryScraper } from "@/marketplaces/amazon/pdp/AmazonPdpCountryScraper";
import { AmazonAd, AmazonCountry } from "@/marketplaces/amazon/types/amazon.types";
import { AmazonPdpResultSender } from "@/marketplaces/amazon/pdp/AmazonPdpResultSender";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { AdOutcome, ItemOutcome } from "@/shared/metrics/metrics.types";

export class AmazonPdpAdScraper {
  inFlight = 0;

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
        .map((country) => new AmazonCountryPrice(country, ad.skipRouteIds))
        .filter((price) => price.route)
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

      this.scrapeTiers(prices, scrapeCountry, isCancelled);
    });
  }

  // A country that falls back to a lower-priority route joins that tier
  private async scrapeTiers(
    prices: AmazonAdPrices,
    scrapeCountry: (price: AmazonCountryPrice) => Promise<void>,
    isCancelled: () => boolean
  ) {
    for (const priority of prices.priorities()) {
      await Promise.all(prices.pendingAt(priority).map(scrapeCountry));
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
    if (price.isFallingBack) {
      this.metricsService.increment("route_fallback", { country: price.country.tld });
      price.nextRoute();
      return;
    }

    price.finish(outcome);

    if (prices.isDeleted) {
      this.resultSender.deleted(ad.id);
      return "deleted";
    }

    if (!prices.isDecided) return;

    const result = prices.toResult(ad.id);
    this.resultSender.prices(ad.id, result.prices, result.missingRouteIds);
    return result.prices.length ? "prices" : "empty";
  }
}
