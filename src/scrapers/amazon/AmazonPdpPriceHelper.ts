import { ApiService } from "@/services/ApiService";
import { AmazonAd, AmazonAdPrice } from "@/types/amazon.types";

export class AmazonPdpPriceHelper {
  private apiService;

  constructor(apiService = ApiService.getInstance()) {
    this.apiService = apiService;
  }

  getPrice(prices: AmazonAdPrice[], countryId: number) {
    return prices?.find((price) => price.country.id === countryId);
  }

  isScrapable(price: AmazonAdPrice) {
    return !price.complete && !price.pending && !price.deleted;
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
        country: price.country,
        value: price.value,
      }));

    if (!prices?.length) return;

    this.apiService.put("amazon/ads/" + ad.id, { prices: prepared });
  }
}
