import type { Document } from "domhandler";
import { parseDocument } from "htmlparser2";
import { AmazonCaptchaDetector } from "@/marketplaces/amazon/AmazonCaptchaDetector";
import { MetricsService } from "@/shared/metrics/MetricsService";
import type { ResponseOutcome } from "@/shared/metrics/metrics.types";

type ReadOptions<T> = {
  country: string;
  trim?: (html: string) => string;
  build: (document: Document) => T;
  hasData: (page: T) => boolean;
};

// Turns a 200 response into a page, counting every result in `responses`
export class AmazonPageReader {
  constructor(
    private flow: string,
    private parseFailure: ResponseOutcome,
    private metricsService = MetricsService.getInstance(),
    private captchaDetector = new AmazonCaptchaDetector()
  ) {}

  read<T extends { isValid?: boolean }>(html: string, options: ReadOptions<T>): T | undefined {
    const { country, trim, build, hasData } = options;
    const count = (outcome: ResponseOutcome) => {
      this.metricsService.increment("responses", { country, outcome });
    };

    if (!html.length) {
      count("empty");
      return;
    }

    try {
      const trimmed = trim ? trim(html) : html;
      if (this.captchaDetector.detect(trimmed)) {
        count("captcha");
        return;
      }

      const page = build(parseDocument(trimmed));
      if (page.isValid === false) {
        count("invalid");
        return;
      }

      count(hasData(page) ? "data" : "no_data");
      return page;
    } catch (e) {
      console.error(`${this.flow}: parse failed`, e);
      count(this.parseFailure);
    }
  }
}
