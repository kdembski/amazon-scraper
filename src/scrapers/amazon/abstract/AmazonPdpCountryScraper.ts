import { AmazonPdpAdBuilder } from "@/builders/AmazonPdpAdBuilder";
import { AmazonPdpPriceHelper } from "@/scrapers/amazon/AmazonPdpPriceHelper";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import { AmazonAd, Country, AmazonAdPrice } from "@/types/amazon.types";
import { parseHTML } from "linkedom";

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
    country: Country,
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolve: () => void
  ): void;

  protected retry(
    country: Country,
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolve: () => void
  ) {
    this.execute(country, ad, prices, resolve);
  }

  protected tryComplete(
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolve: () => void
  ) {
    if (!this.priceHelper.isComplete(prices)) return;
    this.priceHelper.sendCompletedPrices(prices, ad);
    resolve();
  }

  protected tryDelete(
    ad: AmazonAd,
    price: AmazonAdPrice,
    prices: AmazonAdPrice[],
    resolveAd: () => void
  ) {
    price.deleted = true;

    if (!this.priceHelper.isDeleted(prices)) {
      price.resolve?.();
      return 0;
    }

    const toDelete = prices.filter((price) => !price.deleted);
    toDelete.forEach((price) => (price.deleted = true));

    this.apiService.delete("amazon/ads/" + ad.id);
    resolveAd();

    return toDelete.length;
  }
}
