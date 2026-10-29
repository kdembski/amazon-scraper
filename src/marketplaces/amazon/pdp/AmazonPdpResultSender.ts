import { AmazonPdpPrice } from "@/marketplaces/amazon/types/amazon.types";
import { BatchSender } from "@/shared/backend/BatchSender";

type AmazonPdpResult = { id: number; prices?: AmazonPdpPrice[] };

const MAX_BATCH_SIZE = 200;

export class AmazonPdpResultSender {
  private static instance: AmazonPdpResultSender;

  constructor(
    private sender = new BatchSender<AmazonPdpResult>(
      "amazon/ads/batch",
      AmazonPdpResultSender.toBody,
      MAX_BATCH_SIZE
    )
  ) {}

  static getInstance() {
    if (!AmazonPdpResultSender.instance) {
      AmazonPdpResultSender.instance = new AmazonPdpResultSender();
    }
    return AmazonPdpResultSender.instance;
  }

  static toBody(results: AmazonPdpResult[]) {
    return {
      prices: results
        .filter((result) => result.prices)
        .map(({ id, prices }) => ({ id, prices })),
      deleted: results.filter((result) => !result.prices).map((result) => result.id),
    };
  }

  prices(id: number, prices: AmazonPdpPrice[]) {
    this.sender.add({ id, prices });
  }

  deleted(id: number) {
    this.sender.add({ id });
  }
}
