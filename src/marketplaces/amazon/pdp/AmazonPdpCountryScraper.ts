import { AmazonService } from "@/marketplaces/amazon/AmazonService";
import { AmazonAodAdBuilder } from "@/marketplaces/amazon/pdp/AmazonAodAdBuilder";
import { AmazonPdpPriceHelper } from "@/marketplaces/amazon/pdp/AmazonPdpPriceHelper";
import {
  AmazonAd,
  AmazonAdBuilder,
  AmazonAdPrice,
} from "@/marketplaces/amazon/types/amazon.types";
import { ApiService } from "@/shared/backend/ApiService";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { ItemOutcome, ResponseOutcome } from "@/shared/metrics/metrics.types";
import { getRetryDelay, MAX_FAILED_ATTEMPTS } from "@/shared/utils/retry";
import { parseHTML } from "linkedom";
import _ from "lodash";

export class AmazonPdpCountryScraper {
  private amazonService;
  private apiService;
  private builder;
  private priceHelper;
  private metricsService;

  constructor(
    amazonService = AmazonService.getInstance(),
    apiService = ApiService.getInstance(),
    builder: AmazonAdBuilder = new AmazonAodAdBuilder(),
    priceHelper = new AmazonPdpPriceHelper(),
    metricsService = MetricsService.getInstance()
  ) {
    this.amazonService = amazonService;
    this.apiService = apiService;
    this.builder = builder;
    this.priceHelper = priceHelper;
    this.metricsService = metricsService;
  }

  execute(
    price: AmazonAdPrice,
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolveAd: () => void
  ) {
    new Promise<void>((resolvePrice, rejectPrice) => {
      if (price.complete || price.deleted || price.pending || price.adDeleted) {
        return;
      }

      price.resolve = resolvePrice;
      price.reject = rejectPrice;

      const { url, referer } = this.builder.buildUrl(price.country, ad);
      price.pending = true;

      this.amazonService.get<string>(url, referer, {
        onSuccess: (res) => this.onSuccess(res, price),
        onError: (e) => this.onError(e, price, ad, prices, resolveAd),
      });
    })
      .then(() => {
        price.pending = false;
        price.complete = true;
        this.amazonService.queueService.completed++;
        if (!price.deleted) {
          this.countItem(price, _.isNil(price.value) ? "no_data" : "data");
        }
        this.tryComplete(ad, prices, resolveAd);
      })
      .catch(() => {
        price.pending = false;
        price.failed++;
        this.amazonService.queueService.failed++;
        this.retry(price, ad, prices, resolveAd);
      });
  }

  private async onSuccess(data: string, price: AmazonAdPrice) {
    if (!data.length) {
      this.countResponse(price, "empty");
      price.reject?.("Received empty data");
      return;
    }

    const { document } = parseHTML(data);
    const ad = this.builder.build(document);

    if (ad.isCaptcha) {
      this.countResponse(price, "captcha");
      price.reject?.("Captcha occured");
      return;
    }

    if (ad.isValid === false) {
      this.countResponse(price, "invalid");
      price.reject?.("Unexpected response");
      return;
    }

    this.countResponse(price, _.isNil(ad.price) ? "no_data" : "data");
    price.value = ad.price;
    price.dispatchFrom = ad.dispatchFrom;
    price.resolve?.();
  }

  private countResponse(price: AmazonAdPrice, outcome: ResponseOutcome) {
    this.metricsService.increment("responses", {
      country: price.country.code,
      outcome,
    });
  }

  private countItem(price: AmazonAdPrice, outcome: ItemOutcome) {
    const labels = { country: price.country.code, outcome };
    const attempts = outcome === "given_up" ? price.failed : price.failed + 1;
    this.metricsService.increment("items", labels);
    this.metricsService.increment("item_attempts", labels, attempts);
  }

  private onError(
    e: any,
    price: AmazonAdPrice,
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolveAd: () => void
  ) {
    if (e.status === 404) {
      this.tryDelete(ad, price, prices, resolveAd);
      return;
    }

    price.reject?.("Failed");
  }

  private retry(
    price: AmazonAdPrice,
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolve: () => void
  ) {
    // Give up on this country, the ad is completed without its price
    if (price.failed >= MAX_FAILED_ATTEMPTS) {
      price.complete = true;
      this.countItem(price, "given_up");
      this.tryComplete(ad, prices, resolve);
      return;
    }

    setTimeout(
      () => this.execute(price, ad, prices, resolve),
      getRetryDelay(price.failed)
    );
  }

  private tryComplete(
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolve: () => void
  ) {
    const isCompleted = this.priceHelper.isComplete(prices);
    const isDeleted = this.priceHelper.isDeleted(prices);
    if (!isCompleted || isDeleted) return;

    this.priceHelper.sendCompletedPrices(prices, ad);
    resolve();
  }

  private tryDelete(
    ad: AmazonAd,
    price: AmazonAdPrice,
    prices: AmazonAdPrice[],
    resolveAd: () => void
  ) {
    if (price.adDeleted) return;
    price.deleted = true;
    this.countItem(price, "deleted");

    if (!this.priceHelper.isDeleted(prices)) {
      price.resolve?.();
      return;
    }

    prices.forEach((price) => {
      price.deleted = true;
      price.adDeleted = true;
      price.resolve?.();
    });

    this.apiService.delete("amazon/ads/" + ad.id);
    resolveAd();
  }
}
