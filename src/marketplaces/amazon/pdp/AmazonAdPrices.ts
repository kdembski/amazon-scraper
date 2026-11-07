import _ from "lodash";
import type { AmazonCountryPrice } from "@/marketplaces/amazon/pdp/AmazonCountryPrice";

const PRICES_TO_COMPLETE = 4;

// State of one ASIN across its countries
export class AmazonAdPrices {
  constructor(private prices: AmazonCountryPrice[]) {}

  get isEmpty() {
    return !this.prices.length;
  }

  get isDeleted() {
    const active = this.prices.filter((price) => price.country.active);
    return active.length > 0 && active.every((price) => price.deleted);
  }

  get isDecided() {
    return this.prices.every((price) => price.complete) || this.withPrice.length >= PRICES_TO_COMPLETE;
  }

  private get withPrice() {
    return this.prices.filter((price) => price.hasPrice);
  }

  // Groups of countries with the same priority, highest first
  tiers() {
    return _.orderBy(
      Object.values(_.groupBy(this.prices, (price) => price.country.priority)),
      (tier) => tier[0].country.priority,
      "desc"
    );
  }

  toResult(adId: number) {
    return {
      prices: this.withPrice.map((price) => price.toPdpPrice(adId)),
      missingCountryIds: this.prices
        .filter((price) => price.missing)
        .map((price) => price.country.countryId),
    };
  }
}
