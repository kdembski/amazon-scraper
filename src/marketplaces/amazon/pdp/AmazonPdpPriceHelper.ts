import { ApiService } from "@/shared/backend/ApiService";
import { AmazonAd, AmazonAdPrice } from "@/marketplaces/amazon/types/amazon.types";

export const PRICES_TO_COMPLETE = 4;

export class AmazonPdpPriceHelper {
  constructor(private apiService = ApiService.getInstance()) {}

  isComplete(prices: AmazonAdPrice[]) {
    return prices.every((price) => price.complete);
  }

  hasEnoughPrices(prices: AmazonAdPrice[]) {
    return prices.filter((price) => !!price.value).length >= PRICES_TO_COMPLETE;
  }

  isDeleted(prices: AmazonAdPrice[]) {
    const active = prices.filter((price) => price.country.active);
    return active.length > 0 && active.every((price) => price.deleted);
  }

  sendCompletedPrices(prices: AmazonAdPrice[], ad: AmazonAd) {
    if (!prices.length) return;

    const prepared = prices
      .filter((price) => !!price.value)
      .map((price) => ({
        adId: ad.id,
        countryId: price.country.countryId,
        value: price.value,
        dispatchFrom: price.dispatchFrom,
      }));

    this.apiService.put("amazon/ads/" + ad.id, { prices: prepared });
  }
}
