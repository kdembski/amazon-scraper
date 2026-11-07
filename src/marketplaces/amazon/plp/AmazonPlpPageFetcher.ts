import type { Document } from "domhandler";
import { parseDocument } from "htmlparser2";
import { AmazonCaptchaDetector } from "@/marketplaces/amazon/AmazonCaptchaDetector";
import { AmazonService } from "@/marketplaces/amazon/AmazonService";
import { AmazonPlpAd } from "@/marketplaces/amazon/types/amazon.types";
import { ScraperConfigService } from "@/shared/backend/ScraperConfigService";
import { TokenBucketQueue } from "@/shared/http/TokenBucketQueue";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { ResponseOutcome } from "@/shared/metrics/metrics.types";
import { RetryBackoff } from "@/shared/utils/RetryBackoff";
import { sleep } from "@/shared/utils/sleep";

type PlpBuildResult = { isValid: boolean; ads: AmazonPlpAd[] };

const QUEUE_FULL_DELAY = 1000;

export class AmazonPlpPageFetcher {
  constructor(
    private amazonService = AmazonService.getInstance(),
    private queueService = TokenBucketQueue.getInstance(),
    private configService = ScraperConfigService.getInstance(),
    private metricsService = MetricsService.getInstance(),
    private captchaDetector = new AmazonCaptchaDetector()
  ) {}

  async fetch<T extends PlpBuildResult>(
    url: string,
    referer: string,
    build: (document: Document) => T,
    stopAt?: string[]
  ): Promise<{ page?: T; failed: number }> {
    const retry = new RetryBackoff();

    while (!retry.isExhausted) {
      const html = await this.get(url, referer, stopAt);
      const page = html !== undefined && this.build(html, build);
      if (page) return { page, failed: retry.failed };

      retry.fail();
      if (!retry.isExhausted) await retry.wait();
    }

    return { failed: retry.failed };
  }

  private build<T extends PlpBuildResult>(
    html: string,
    build: (document: Document) => T
  ) {
    if (!html.length) {
      this.countResponse("empty");
      return;
    }

    try {
      const document = parseDocument(html);
      if (this.captchaDetector.detect(document)) {
        this.countResponse("captcha");
        return;
      }

      const page = build(document);
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

  private async get(url: string, referer: string, stopAt?: string[]) {
    const { batchSize } = this.configService.get();
    while (this.queueService.queue.length >= batchSize) {
      await sleep(QUEUE_FULL_DELAY);
    }

    return this.amazonService.get<string>(url, referer, { stopAt }).catch(() => undefined);
  }

  private countResponse(outcome: ResponseOutcome) {
    this.metricsService.increment("responses", { country: "pl", outcome });
  }
}
