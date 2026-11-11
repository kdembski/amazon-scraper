import type { Document } from "domhandler";
import { AmazonPageReader } from "@/marketplaces/amazon/AmazonPageReader";
import { AmazonService } from "@/marketplaces/amazon/AmazonService";
import { AmazonPlpAd } from "@/marketplaces/amazon/types/amazon.types";
import { ScraperConfigService } from "@/shared/backend/ScraperConfigService";
import { TokenBucketQueue } from "@/shared/http/TokenBucketQueue";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { RetryBackoff } from "@/shared/utils/RetryBackoff";
import { sleep } from "@/shared/utils/sleep";

type PlpBuildResult = { isValid: boolean; ads: AmazonPlpAd[] };

const QUEUE_FULL_DELAY = 1000;

export const PLP_MAX_FAILED_ATTEMPTS = 10;

const PLP_PROXY_TYPE = "mixed1/2";

export class AmazonPlpPageFetcher {
  constructor(
    private amazonService = AmazonService.getInstance(),
    private queueService = TokenBucketQueue.getInstance(),
    private configService = ScraperConfigService.getInstance(),
    private metricsService = MetricsService.getInstance(),
    private pageReader = new AmazonPageReader("plp", "invalid", metricsService)
  ) {}

  async fetch<T extends PlpBuildResult>(
    url: string,
    referer: string,
    build: (document: Document) => T,
    stopAt?: string[]
  ): Promise<{ page?: T; failed: number }> {
    const retry = new RetryBackoff(PLP_MAX_FAILED_ATTEMPTS);

    while (!retry.isExhausted) {
      const html = await this.get(url, referer, stopAt);
      const page =
        html !== undefined &&
        this.pageReader.read(html, {
          country: "pl",
          build,
          hasData: (result) => result.ads.length > 0,
        });
      if (page) return { page, failed: retry.failed };

      retry.fail();
      if (!retry.isExhausted) await retry.wait();
    }

    return { failed: retry.failed };
  }

  private async get(url: string, referer: string, stopAt?: string[]) {
    const { batchSize } = this.configService.get();
    while (this.queueService.queue.length >= batchSize) {
      await sleep(QUEUE_FULL_DELAY);
    }

    return this.amazonService
      .get<string>(url, referer, { stopAt, proxyType: PLP_PROXY_TYPE })
      .catch(() => undefined);
  }
}
