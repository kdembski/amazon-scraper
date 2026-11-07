import type { AmazonCountry, AmazonPdpPrice } from "@/marketplaces/amazon/types/amazon.types";
import type { ItemOutcome } from "@/shared/metrics/metrics.types";
import { RetryBackoff } from "@/shared/utils/RetryBackoff";

export const NOT_FOUND_TO_DELETE = 2;

// State of one ASIN in one country
export class AmazonCountryPrice {
  value?: number;
  dispatchFrom?: string;
  complete = false;
  deleted = false;
  // A 404 from the last source
  missing = false;
  notFound = 0;
  retry = new RetryBackoff();

  constructor(public country: AmazonCountry) {}

  get hasPrice() {
    return !!this.value;
  }

  setResult(value?: number, dispatchFrom?: string) {
    this.value = value;
    this.dispatchFrom = dispatchFrom;
  }

  // True once the 404s mean the product is gone from this country
  registerNotFound() {
    this.notFound++;
    if (this.notFound < (this.country.active ? NOT_FOUND_TO_DELETE : 1)) return false;

    this.missing = true;
    return true;
  }

  finish(outcome: ItemOutcome) {
    this.complete = true;
    this.deleted = outcome === "deleted";
  }

  toPdpPrice(adId: number): AmazonPdpPrice {
    return {
      adId,
      countryId: this.country.countryId,
      value: this.value,
      dispatchFrom: this.dispatchFrom,
    };
  }
}
