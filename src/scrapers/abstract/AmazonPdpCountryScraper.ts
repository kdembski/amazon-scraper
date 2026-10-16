import { AmazonAodAdBuilder } from "@/builders/AmazonAodAdBuilder";
import { AmazonPdpAdBuilder } from "@/builders/AmazonPdpAdBuilder";
import { getRetryDelay, MAX_FAILED_ATTEMPTS } from "@/helpers/retry";
import { AmazonPdpPriceHelper } from "@/scrapers/AmazonPdpPriceHelper";
import { ApiService } from "@/services/ApiService";
import { ArgsService } from "@/services/ArgsService";
import {
  AmazonAd,
  AmazonAdBuilder,
  AmazonAdPrice,
} from "@/types/amazon.types";

export abstract class AmazonPdpCountryScraper {
  protected apiService;
  protected builder;
  protected priceHelper;

  constructor(
    apiService = ApiService.getInstance(),
    builder: AmazonAdBuilder = ArgsService.getInstance().getSourceFlag().isAod
      ? new AmazonAodAdBuilder()
      : new AmazonPdpAdBuilder(),
    priceHelper = new AmazonPdpPriceHelper()
  ) {
    this.apiService = apiService;
    this.builder = builder;
    this.priceHelper = priceHelper;
  }

  abstract execute(
    price: AmazonAdPrice,
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolve: () => void
  ): void;

  protected retry(
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

  protected tryComplete(
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

  protected tryDelete(
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
