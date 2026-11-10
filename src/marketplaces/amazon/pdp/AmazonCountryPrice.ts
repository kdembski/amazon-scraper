import _ from "lodash";
import type { AmazonCountry, AmazonCountryRoute, AmazonPdpPrice } from "@/marketplaces/amazon/types/amazon.types";
import type { ItemOutcome } from "@/shared/metrics/metrics.types";
import { RetryBackoff } from "@/shared/utils/RetryBackoff";

export const NOT_FOUND_TO_DELETE = 2;

// State of one ASIN in one country, scraped through its routes one by one
export class AmazonCountryPrice {
  value?: number;
  dispatchFrom?: string;
  complete = false;
  deleted = false;
  // Routes that ended with a 404
  missingRouteIds: number[] = [];
  notFound = 0;
  // Attempts of the routes already left
  pastAttempts = 0;
  retry: RetryBackoff;
  private routes: AmazonCountryRoute[];

  constructor(public country: AmazonCountry, skipRouteIds: number[] = []) {
    this.routes = _.orderBy(
      country.routes.filter((route) => !skipRouteIds.includes(route.id)),
      (route) => route.priority,
      "desc"
    );
    this.retry = new RetryBackoff(this.route?.maxAttempts);
  }

  get route(): AmazonCountryRoute | undefined {
    return this.routes[0];
  }

  get priorities() {
    return this.routes.map((route) => route.priority);
  }

  get hasPrice() {
    return !!this.value;
  }

  // The current route ended with a 404 and a lower-priority route is left
  get isFallingBack() {
    return this.routes.length > 1 && this.missingRouteIds.includes(this.routes[0].id);
  }

  setResult(value?: number, dispatchFrom?: string) {
    this.value = value;
    this.dispatchFrom = dispatchFrom;
  }

  markMissing() {
    this.missingRouteIds.push(this.routes[0].id);
  }

  // True once the 404s mean the product is gone from the current route
  registerNotFound() {
    this.notFound++;
    if (this.notFound < (this.country.active ? NOT_FOUND_TO_DELETE : 1)) return false;

    this.markMissing();
    return true;
  }

  nextRoute() {
    this.pastAttempts += this.retry.failed + 1;
    this.routes.shift();
    this.notFound = 0;
    this.retry = new RetryBackoff(this.routes[0].maxAttempts);
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
