import { AmazonPdpAdBuilder } from "@/builders/AmazonPdpAdBuilder";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import { AmazonAd, Country, AmazonAdPrice } from "@/types/amazon.types";
import { parseHTML } from "linkedom";

export class AmazonPdpPriceHelper {
  private apiService;

  constructor(apiService = ApiService.getInstance()) {
    this.apiService = apiService;
  }

  getPrice(prices: AmazonAdPrice[], countryId: number) {
    return prices?.find((price) => price.country.id === countryId);
  }

  isComplete(prices: AmazonAdPrice[]) {
    return prices?.every((price) => price.complete);
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

  getPriceMultiplier(countryCode: string, deliveryCode?: string) {
    if (!deliveryCode) return 1;
    const multipliers: Record<string, any> = {
      fr: {
        ca: 1.2,
      },
      it: {
        ca: 1.22,
      },
      de: {
        ca: 1.23,
      },
    };

    return (multipliers[countryCode][deliveryCode] as number) || 1;
  }
}
