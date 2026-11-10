import _ from "lodash";
import type { AmazonCountryPrice } from "@/marketplaces/amazon/pdp/AmazonCountryPrice";

const PRICES_TO_COMPLETE = 5;

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

  // Route priorities of all countries, highest first
  priorities() {
    return _.orderBy(_.uniq(this.prices.flatMap((price) => price.priorities)), _.identity, "desc");
  }

  // Countries still waiting whose current route has this priority
  pendingAt(priority: number) {
    return this.prices.filter((price) => !price.complete && price.route?.priority === priority);
  }

  toResult(adId: number) {
    return {
      prices: this.withPrice.map((price) => price.toPdpPrice(adId)),
      missingRouteIds: this.prices.flatMap((price) => price.missingRouteIds),
    };
  }
}
