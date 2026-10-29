import { AmazonPlpAd } from "@/marketplaces/amazon/types/amazon.types";
import { BatchSender } from "@/shared/backend/BatchSender";

const MAX_BATCH_SIZE = 500;

export class AmazonPlpAdSender {
  private static instance: AmazonPlpAdSender;

  constructor(
    private sender = new BatchSender<AmazonPlpAd>("amazon/ads", (ads) => ads, MAX_BATCH_SIZE)
  ) {}

  static getInstance() {
    if (!AmazonPlpAdSender.instance) {
      AmazonPlpAdSender.instance = new AmazonPlpAdSender();
    }
    return AmazonPlpAdSender.instance;
  }

  add(ads: AmazonPlpAd[]) {
    ads.forEach((ad) => this.sender.add(ad));
  }
}
