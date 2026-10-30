import { AmazonPdpCountryScraper } from "@/marketplaces/amazon/pdp/AmazonPdpCountryScraper";
import { AmazonPdpPriceHelper } from "@/marketplaces/amazon/pdp/AmazonPdpPriceHelper";
import {
  AmazonAd,
  AmazonAdPrice,
  AmazonCountry,
} from "@/marketplaces/amazon/types/amazon.types";
import { AmazonPdpResultSender } from "@/marketplaces/amazon/pdp/AmazonPdpResultSender";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { AdOutcome, ItemOutcome } from "@/shared/metrics/metrics.types";
import _ from "lodash";

export class AmazonPdpAdScraper {
  private inFlight = 0;

  constructor(
    private countryScraper = new AmazonPdpCountryScraper(),
    private priceHelper = new AmazonPdpPriceHelper(),
    private resultSender = AmazonPdpResultSender.getInstance(),
    private metricsService = MetricsService.getInstance()
  ) {
    metricsService.gauge("ads_in_flight", () => this.inFlight);
  }

  execute(ad: AmazonAd, countries: AmazonCountry[]) {
    const prices = this.createPrices(countries);
    const startedAt = Date.now();
    let isDone = false;
    const isCancelled = () => isDone;
    this.inFlight++;

    return new Promise<void>((resolve) => {
      const scrapeCountry = async (price: AmazonAdPrice) => {
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

      this.scrapeTiers(this.groupIntoTiers(prices), scrapeCountry, isCancelled);
    });
  }

  private createPrices(countries: AmazonCountry[]): AmazonAdPrice[] {
    return countries.map((country) => ({
      country,
      complete: false,
      deleted: false,
      failed: 0,
      notFound: 0,
    }));
  }

  private groupIntoTiers(prices: AmazonAdPrice[]) {
    return _.orderBy(
      Object.values(_.groupBy(prices, (price) => price.country.priority)),
      (tier) => tier[0].country.priority,
      "desc"
    );
  }

  private async scrapeTiers(
    tiers: AmazonAdPrice[][],
    scrapeCountry: (price: AmazonAdPrice) => Promise<void>,
    isCancelled: () => boolean
  ) {
    for (const tier of tiers) {
      await Promise.all(tier.map(scrapeCountry));
      if (isCancelled()) return;
    }
  }

  // The outcome of the ad once it is decided
  private applyOutcome(
    price: AmazonAdPrice,
    outcome: ItemOutcome,
    prices: AmazonAdPrice[],
    ad: AmazonAd
  ): AdOutcome | undefined {
    price.complete = true;
    price.deleted = outcome === "deleted";

    if (this.priceHelper.isDeleted(prices)) {
      this.resultSender.deleted(ad.id);
      return "deleted";
    }

    const isComplete = this.priceHelper.isComplete(prices);
    if (!isComplete && !this.priceHelper.hasEnoughPrices(prices)) return;

    this.priceHelper.sendCompletedPrices(prices, ad);
    return prices.some((price) => !!price.value) ? "prices" : "empty";
  }
}
