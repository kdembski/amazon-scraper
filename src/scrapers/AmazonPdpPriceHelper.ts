import { ApiService } from "@/services/ApiService";
import { AmazonAd, AmazonAdPrice } from "@/types/amazon.types";

export class AmazonPdpPriceHelper {
  private apiService;

  constructor(apiService = ApiService.getInstance()) {
    this.apiService = apiService;
  }

  isComplete(prices: AmazonAdPrice[]) {
    return prices?.every((price) => price.complete);
  }

  isDeleted(prices: AmazonAdPrice[]) {
    return prices?.filter((price) => !price.deleted).length <= 2;
  }

  sendCompletedPrices(prices: AmazonAdPrice[], ad: AmazonAd) {
    const prepared = prices
      ?.filter((price) => !!price.value)
      .map((price) => ({
        adId: ad.id,
        countryId: price.country.id,
        value: price.value,
      }));

    if (!prices?.length) return;

    const controller = new AbortController();
    ad.controller = controller;

    this.apiService.put(
      "amazon/ads/" + ad.id,
      { prices: prepared },
      controller.signal
    );
  }
}
