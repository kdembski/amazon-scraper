import { AmazonPlpAd } from "@/marketplaces/amazon/types/amazon.types";
import { ApiService } from "@/shared/backend/ApiService";

// One run over a category: sends every ASIN to the backend once
export class AmazonPlpCrawl {
  readonly asins = new Set<string>();

  constructor(
    readonly category: string,
    readonly allPages: boolean,
    private apiService = ApiService.getInstance()
  ) {}

  post(ads: AmazonPlpAd[]) {
    const fresh = ads.filter((ad) => !this.asins.has(ad.asin));
    fresh.forEach((ad) => this.asins.add(ad.asin));
    if (fresh.length) this.apiService.post("amazon/ads", fresh);
    return fresh.length;
  }
}
