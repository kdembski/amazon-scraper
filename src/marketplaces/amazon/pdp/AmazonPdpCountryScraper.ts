import { AmazonService } from "@/marketplaces/amazon/AmazonService";
import { AmazonAodAdBuilder } from "@/marketplaces/amazon/pdp/AmazonAodAdBuilder";
import { AmazonTwisterAdBuilder } from "@/marketplaces/amazon/pdp/AmazonTwisterAdBuilder";
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
    private builders: Record<string, AmazonAdBuilder> = {
      aod: new AmazonAodAdBuilder(),
      twister: new AmazonTwisterAdBuilder(),
    },
    private metricsService = MetricsService.getInstance()
  ) {}

  async execute(
    price: AmazonAdPrice,
    ad: AmazonAd,
    isCancelled: () => boolean
  ): Promise<ItemOutcome | undefined> {
    let builder = this.builders[price.country.pdpSource] ?? this.builders.aod;

    while (!isCancelled()) {
      const result = await this.fetch(builder, ad, price, isCancelled);
      if (isCancelled()) return;

      if (!result.ok && result.status === 404 && builder !== this.builders.aod) {
        builder = this.builders.aod;
        continue;
      }

      const outcome = this.toOutcome(result, price, builder);
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
    builder: AmazonAdBuilder,
    ad: AmazonAd,
    price: AmazonAdPrice,
    isCancelled: () => boolean
  ) {
    const { url, referer } = builder.buildUrl(price.country, ad);

    return new Promise<FetchResult>((resolve) => {
      this.amazonService.get<string>(
        url,
        referer,
        {
          onSuccess: (data) => resolve({ ok: true, data }),
          onError: (e) => resolve({ ok: false, status: e?.status }),
          isCancelled,
        },
        price.country.proxyType,
        builder.stopAt
      );
    });
  }

  private toOutcome(
    result: FetchResult,
    price: AmazonAdPrice,
    builder: AmazonAdBuilder
  ): ItemOutcome | undefined {
    if (!result.ok) return result.status === 404 ? "deleted" : undefined;

    if (!result.data.length) {
      this.countResponse(price, "empty");
      return;
    }

    try {
      const ad = builder.build(parseDocument(builder.trimHtml(result.data)));

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
