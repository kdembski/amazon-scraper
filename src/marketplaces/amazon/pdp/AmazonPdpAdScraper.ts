import { AmazonPdpCountryScraper } from "@/marketplaces/amazon/pdp/AmazonPdpCountryScraper";
import { AmazonPdpPriceHelper } from "@/marketplaces/amazon/pdp/AmazonPdpPriceHelper";
import {
  AmazonAd,
  AmazonAdPrice,
  AmazonCountry,
} from "@/marketplaces/amazon/types/amazon.types";
import { ApiService } from "@/shared/backend/ApiService";
import _ from "lodash";

export class AmazonPdpAdScraper {
  constructor(
    private countryScraper = new AmazonPdpCountryScraper(),
    private priceHelper = new AmazonPdpPriceHelper(),
    private apiService = ApiService.getInstance()
  ) {}

  execute(ad: AmazonAd, countries: AmazonCountry[]) {
    const prices: AmazonAdPrice[] = countries.map((country) => ({
      country,
      complete: false,
      deleted: false,
      failed: 0,
    }));
    const tiers = _.orderBy(
      Object.values(_.groupBy(prices, (price) => price.country.priority)),
      (tier) => tier[0].country.priority,
      "desc"
    );
    let isDone = false;
    const isCancelled = () => isDone;

    return new Promise<void>((resolve) => {
      const finish = () => {
        isDone = true;
        resolve();
      };

      const scrapeCountry = async (price: AmazonAdPrice) => {
        const outcome = await this.countryScraper.execute(price, ad, isCancelled);
        if (!outcome || isDone) return;

        price.complete = true;
        price.deleted = outcome === "deleted";

        if (this.priceHelper.isDeleted(prices)) {
          this.apiService.delete("amazon/ads/" + ad.id);
          finish();
          return;
        }

        const isComplete = this.priceHelper.isComplete(prices);
        if (!isComplete && !this.priceHelper.hasEnoughPrices(prices)) return;

        this.priceHelper.sendCompletedPrices(prices, ad);
        finish();
      };

      const scrapeTiers = async () => {
        for (const tier of tiers) {
          await Promise.all(tier.map(scrapeCountry));
          if (isDone) return;
        }
      };

      scrapeTiers();
    });
  }
}
