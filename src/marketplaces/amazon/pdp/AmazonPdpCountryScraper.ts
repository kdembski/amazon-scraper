import { AmazonService } from "@/marketplaces/amazon/AmazonService";
import { AmazonAodAdBuilder } from "@/marketplaces/amazon/pdp/AmazonAodAdBuilder";
import {
  AmazonAd,
  AmazonAdBuilder,
  AmazonAdPrice,
} from "@/marketplaces/amazon/types/amazon.types";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { ItemOutcome, ResponseOutcome } from "@/shared/metrics/metrics.types";
import { getRetryDelay, MAX_FAILED_ATTEMPTS } from "@/shared/utils/retry";
import { sleep } from "@/shared/utils/sleep";
import { parseDocument } from "htmlparser2";
import _ from "lodash";

type FetchResult = { ok: true; data: string } | { ok: false; status?: number };

export class AmazonPdpCountryScraper {
  constructor(
    private amazonService = AmazonService.getInstance(),
    private builder: AmazonAdBuilder = new AmazonAodAdBuilder(),
    private metricsService = MetricsService.getInstance()
  ) {}

  async execute(
    price: AmazonAdPrice,
    ad: AmazonAd,
    isCancelled: () => boolean
  ): Promise<ItemOutcome | undefined> {
    const { url, referer } = this.builder.buildUrl(price.country, ad);

    while (!isCancelled()) {
      const result = await this.fetch(url, referer, price, isCancelled);
      if (isCancelled()) return;

      const outcome = this.toOutcome(result, price);
      if (outcome) {
        this.countItem(price, outcome);
        return outcome;
      }

      price.failed++;
      if (price.failed >= MAX_FAILED_ATTEMPTS) {
        this.countItem(price, "given_up");
        return "given_up";
      }

      await sleep(getRetryDelay(price.failed));
    }
  }

  private fetch(
    url: string,
    referer: string,
    price: AmazonAdPrice,
    isCancelled: () => boolean
  ) {
    return new Promise<FetchResult>((resolve) => {
      this.amazonService.get<string>(
        url,
        referer,
        {
          onSuccess: (data) => resolve({ ok: true, data }),
          onError: (e) => resolve({ ok: false, status: e?.status }),
          isCancelled,
        },
        price.country.proxyType
      );
    });
  }

  private toOutcome(result: FetchResult, price: AmazonAdPrice): ItemOutcome | undefined {
    if (!result.ok) return result.status === 404 ? "deleted" : undefined;

    if (!result.data.length) {
      this.countResponse(price, "empty");
      return;
    }

    try {
      const ad = this.builder.build(parseDocument(this.builder.trimHtml(result.data)));

      if (ad.isCaptcha) {
        this.countResponse(price, "captcha");
        return;
      }

      if (ad.isValid === false) {
        this.countResponse(price, "invalid");
        return;
      }

      const outcome = _.isNil(ad.price) ? "no_data" : "data";
      this.countResponse(price, outcome);
      price.value = ad.price;
      price.dispatchFrom = ad.dispatchFrom;
      return outcome;
    } catch (e) {
      console.error("pdp: parse failed", e);
    }
  }

  private countResponse(price: AmazonAdPrice, outcome: ResponseOutcome) {
    this.metricsService.increment("responses", {
      country: price.country.tld,
      outcome,
    });
  }

  private countItem(price: AmazonAdPrice, outcome: ItemOutcome) {
    const labels = { country: price.country.tld, outcome };
    const attempts = outcome === "given_up" ? price.failed : price.failed + 1;
    this.metricsService.increment("items", labels);
    this.metricsService.increment("item_attempts", labels, attempts);
  }
}
