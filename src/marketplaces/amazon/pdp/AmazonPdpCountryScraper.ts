import { AmazonService } from "@/marketplaces/amazon/AmazonService";
import { AmazonAodAdBuilder } from "@/marketplaces/amazon/pdp/AmazonAodAdBuilder";
import { AmazonPdpAdBuilder } from "@/marketplaces/amazon/pdp/AmazonPdpAdBuilder";
import { AmazonPdpPriceHelper } from "@/marketplaces/amazon/pdp/AmazonPdpPriceHelper";
import {
  AmazonAd,
  AmazonAdBuilder,
  AmazonAdPrice,
} from "@/marketplaces/amazon/types/amazon.types";
import { ArgsService } from "@/shared/args/ArgsService";
import { ApiService } from "@/shared/backend/ApiService";
import { getRetryDelay, MAX_FAILED_ATTEMPTS } from "@/shared/utils/retry";
import { parseHTML } from "linkedom";

export class AmazonPdpCountryScraper {
  private amazonService;
  private apiService;
  private builder;
  private priceHelper;

  constructor(
    amazonService = AmazonService.getInstance(),
    apiService = ApiService.getInstance(),
    builder: AmazonAdBuilder = ArgsService.getInstance().getSourceFlag().isAod
      ? new AmazonAodAdBuilder()
      : new AmazonPdpAdBuilder(),
    priceHelper = new AmazonPdpPriceHelper()
  ) {
    this.amazonService = amazonService;
    this.apiService = apiService;
    this.builder = builder;
    this.priceHelper = priceHelper;
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
      price.reject?.("Received empty data");
      return;
    }

    const { document } = parseHTML(data);
    const ad = this.builder.build(document);

    if (ad.isCaptcha) {
      price.reject?.("Captcha occured");
      return;
    }

    if (ad.isValid === false) {
      price.reject?.("Unexpected response");
      return;
    }

    price.value = ad.price;
    price.dispatchFrom = ad.dispatchFrom;
    price.resolve?.();
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
