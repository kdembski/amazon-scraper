import { ApiService } from "@/shared/backend/ApiService";
import { AmazonAd, AmazonAdPrice } from "@/marketplaces/amazon/types/amazon.types";

export const PRICES_TO_COMPLETE = 4;

export class AmazonPdpPriceHelper {
  private apiService;

  constructor(apiService = ApiService.getInstance()) {
    this.apiService = apiService;
  }

  isComplete(prices: AmazonAdPrice[]) {
    return prices?.every((price) => price.complete);
  }

  hasEnoughPrices(prices: AmazonAdPrice[]) {
    return prices.filter((price) => !!price.value).length >= PRICES_TO_COMPLETE;
  }

  isDeleted(prices: AmazonAdPrice[]) {
    const remaining = prices.filter((price) => !price.deleted).length;
    return remaining < prices.length && remaining <= 2;
  }

  sendCompletedPrices(prices: AmazonAdPrice[], ad: AmazonAd) {
    const prepared = prices
      ?.filter((price) => !!price.value)
      .map((price) => ({
        adId: ad.id,
        countryId: price.country.countryId,
        value: price.value,
        dispatchFrom: price.dispatchFrom,
      }));

    if (!prices?.length) return;
    this.apiService.put("amazon/ads/" + ad.id, { prices: prepared });
  }
}
