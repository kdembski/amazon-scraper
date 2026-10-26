import type { Document } from "domhandler";
import { parseDocument } from "htmlparser2";
import { AmazonService } from "@/marketplaces/amazon/AmazonService";
import { AmazonPlpAd } from "@/marketplaces/amazon/types/amazon.types";
import { ScraperConfigService } from "@/shared/backend/ScraperConfigService";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { ResponseOutcome } from "@/shared/metrics/metrics.types";
import { getRetryDelay, MAX_FAILED_ATTEMPTS } from "@/shared/utils/retry";
import { sleep } from "@/shared/utils/sleep";

export type PlpBuildResult = { isValid: boolean; ads: AmazonPlpAd[] };

const QUEUE_FULL_DELAY = 1000;

export class AmazonPlpPageFetcher {
  constructor(
    private amazonService = AmazonService.getInstance(),
    private configService = ScraperConfigService.getInstance(),
    private metricsService = MetricsService.getInstance()
  ) {}

  async fetch<T extends PlpBuildResult>(
    url: string,
    referer: string,
    build: (document: Document) => T
  ): Promise<{ page?: T; failed: number }> {
    for (let failed = 0; failed < MAX_FAILED_ATTEMPTS; failed++) {
      if (failed) await sleep(getRetryDelay(failed));

      const html = await this.get(url, referer);
      const page = html === undefined ? undefined : this.build(html, build);
      if (page) return { page, failed };
    }

    return { failed: MAX_FAILED_ATTEMPTS };
  }

  private build<T extends PlpBuildResult>(html: string, build: (document: Document) => T) {
    if (!html.length) {
      this.countResponse("empty");
      return;
    }

    try {
      const page = build(parseDocument(html));
      if (!page.isValid) {
        this.countResponse("invalid");
        return;
      }

      this.countResponse(page.ads.length ? "data" : "no_data");
      return page;
    } catch (e) {
      console.error("plp: parse failed", e);
      this.countResponse("invalid");
    }
  }

  private async get(url: string, referer: string) {
    const { batchSize } = this.configService.get();
    while (this.amazonService.queueService.queue.length >= batchSize) {
      await sleep(QUEUE_FULL_DELAY);
    }

    return new Promise<string | undefined>((resolve) =>
      this.amazonService.get<string>(url, referer, {
        onSuccess: resolve,
        onError: () => resolve(undefined),
      })
    );
  }

  private countResponse(outcome: ResponseOutcome) {
    this.metricsService.increment("responses", { country: "pl", outcome });
  }
}
