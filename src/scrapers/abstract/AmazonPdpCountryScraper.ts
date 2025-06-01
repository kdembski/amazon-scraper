import { AmazonPdpAdBuilder } from "@/builders/AmazonPdpAdBuilder";
import { AmazonPdpPriceHelper } from "@/scrapers/AmazonPdpPriceHelper";
import { ApiService } from "@/services/ApiService";
import { AmazonAd, AmazonAdPrice } from "@/types/amazon.types";

export abstract class AmazonPdpCountryScraper {
  protected apiService;
  protected builder;
  protected priceHelper;

  constructor(
    apiService = ApiService.getInstance(),
    builder = new AmazonPdpAdBuilder(),
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
    this.execute(price, ad, prices, resolve);
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
      price.controller?.abort();
      price.resolve?.();
    });

    ad.controller?.abort();
    this.apiService.delete("amazon/ads/" + ad.id);
    resolveAd();
  }
}
