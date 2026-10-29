import { AmazonPdpCountryScraper } from "@/marketplaces/amazon/pdp/AmazonPdpCountryScraper";
import { AmazonPdpPriceHelper } from "@/marketplaces/amazon/pdp/AmazonPdpPriceHelper";
import {
  AmazonAd,
  AmazonAdPrice,
  AmazonCountry,
} from "@/marketplaces/amazon/types/amazon.types";
import { AmazonPdpResultSender } from "@/marketplaces/amazon/pdp/AmazonPdpResultSender";
import { ItemOutcome } from "@/shared/metrics/metrics.types";
import _ from "lodash";

export class AmazonPdpAdScraper {
  constructor(
    private countryScraper = new AmazonPdpCountryScraper(),
    private priceHelper = new AmazonPdpPriceHelper(),
    private resultSender = AmazonPdpResultSender.getInstance()
  ) {}

  execute(ad: AmazonAd, countries: AmazonCountry[]) {
    const prices = this.createPrices(countries);
    let isDone = false;
    const isCancelled = () => isDone;

    return new Promise<void>((resolve) => {
      const scrapeCountry = async (price: AmazonAdPrice) => {
        const outcome = await this.countryScraper.execute(price, ad, isCancelled);
        if (!outcome || isDone) return;
        if (!this.applyOutcome(price, outcome, prices, ad)) return;

        isDone = true;
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

  private applyOutcome(
    price: AmazonAdPrice,
    outcome: ItemOutcome,
    prices: AmazonAdPrice[],
    ad: AmazonAd
  ): boolean {
    price.complete = true;
    price.deleted = outcome === "deleted";

    if (this.priceHelper.isDeleted(prices)) {
      this.resultSender.deleted(ad.id);
      return true;
    }

    const isComplete = this.priceHelper.isComplete(prices);
    if (!isComplete && !this.priceHelper.hasEnoughPrices(prices)) return false;

    this.priceHelper.sendCompletedPrices(prices, ad);
    return true;
  }
}
