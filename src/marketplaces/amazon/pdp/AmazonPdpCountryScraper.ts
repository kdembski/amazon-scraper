import { AmazonPageReader } from "@/marketplaces/amazon/AmazonPageReader";
import { AmazonService } from "@/marketplaces/amazon/AmazonService";
import { AmazonAodAdBuilder } from "@/marketplaces/amazon/pdp/builders/AmazonAodAdBuilder";
import { AmazonAwdAdBuilder } from "@/marketplaces/amazon/pdp/builders/AmazonAwdAdBuilder";
import { AmazonTwisterAdBuilder } from "@/marketplaces/amazon/pdp/builders/AmazonTwisterAdBuilder";
import type { AmazonCountryPrice } from "@/marketplaces/amazon/pdp/AmazonCountryPrice";
import { AmazonAd, AmazonAdBuilder } from "@/marketplaces/amazon/types/amazon.types";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { ItemOutcome } from "@/shared/metrics/metrics.types";
import _ from "lodash";

type FetchResult =
  | { ok: true; data: string }
  | { ok: false; status?: number };

export class AmazonPdpCountryScraper {
  constructor(
    private amazonService = AmazonService.getInstance(),
    private builders: Record<string, AmazonAdBuilder> = {
      aod: new AmazonAodAdBuilder(),
      twister: new AmazonTwisterAdBuilder(),
      awd: new AmazonAwdAdBuilder(),
    },
    private metricsService = MetricsService.getInstance(),
    private pageReader = new AmazonPageReader("pdp", "parse_error", metricsService)
  ) {}

  async execute(
    price: AmazonCountryPrice,
    ad: AmazonAd,
    isCancelled: () => boolean
  ): Promise<ItemOutcome | undefined> {
    const sources = this.getSources(price.country.pdpSource);
    let builder = sources.shift()!;

    while (!isCancelled()) {
      const result = await this.fetch(builder, ad, price, isCancelled);
      if (isCancelled()) return;

      if (!result.ok && result.status === 404 && sources.length) {
        this.metricsService.increment("source_fallback", { country: price.country.tld });
        builder = sources.shift()!;
        continue;
      }

      const outcome = this.toOutcome(result, price, builder);
      if (outcome) {
        this.countItem(price, outcome);
        return outcome;
      }

      price.retry.fail();
      if (price.retry.isExhausted) {
        this.countItem(price, "given_up");
        return "given_up";
      }

      await price.retry.wait();
    }
  }

  // "twister,awd": the next source is asked on a 404
  private getSources(pdpSource: string) {
    const sources = _.compact(
      pdpSource.split(",").map((source) => this.builders[source.trim()])
    );
    return sources.length ? sources : [this.builders.aod];
  }

  private async fetch(
    builder: AmazonAdBuilder,
    ad: AmazonAd,
    price: AmazonCountryPrice,
    isCancelled: () => boolean
  ): Promise<FetchResult> {
    const { url, referer } = builder.buildUrl(price.country, ad);

    try {
      const data = await this.amazonService.get<string>(url, referer, {
        proxyType: price.country.proxyType,
        stopAt: builder.stopAt,
        isCancelled,
      });
      return { ok: true, data: data ?? "" };
    } catch (e: any) {
      return { ok: false, status: e?.status };
    }
  }

  private toOutcome(
    result: FetchResult,
    price: AmazonCountryPrice,
    builder: AmazonAdBuilder
  ): ItemOutcome | undefined {
    if (!result.ok) {
      if (result.status !== 404) return;
      if (builder.notFoundIsNoData) {
        price.missing = true;
        return "no_data";
      }
      return price.registerNotFound() ? "deleted" : undefined;
    }

    const ad = this.pageReader.read(result.data, {
      country: price.country.tld,
      trim: (html) => builder.trimHtml(html),
      build: (document) => builder.build(document),
      hasData: (page) => !!page.price,
    });
    if (!ad) return;

    price.setResult(ad.price, ad.dispatchFrom);
    return ad.price ? "data" : "no_data";
  }

  private countItem(price: AmazonCountryPrice, outcome: ItemOutcome) {
    const labels = { country: price.country.tld, outcome };
    const attempts = outcome === "given_up" ? price.retry.failed : price.retry.failed + 1;
    this.metricsService.increment("items", labels);
    this.metricsService.increment("item_attempts", labels, attempts);
  }
}
