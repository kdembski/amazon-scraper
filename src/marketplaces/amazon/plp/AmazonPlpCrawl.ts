import { AmazonPlpAdSender } from "@/marketplaces/amazon/plp/AmazonPlpAdSender";
import { AmazonPlpAd } from "@/marketplaces/amazon/types/amazon.types";

// One run over a category: sends every ASIN to the backend once
export class AmazonPlpCrawl {
  readonly asins = new Set<string>();

  constructor(
    readonly category: string,
    readonly allPages: boolean,
    private adSender = AmazonPlpAdSender.getInstance()
  ) {}

  post(ads: AmazonPlpAd[]) {
    const fresh = ads.filter((ad) => !this.asins.has(ad.asin));
    fresh.forEach((ad) => this.asins.add(ad.asin));
    if (fresh.length) this.adSender.add(fresh);
    return fresh.length;
  }
}
