import { AmazonPdpAdBuilder } from "@/builders/AmazonPdpAdBuilder";
import { AmazonPdpPriceHelper } from "@/scrapers/amazon/AmazonPdpPriceHelper";
import { ApiService } from "@/services/ApiService";
import { AmazonAd, Country, AmazonAdPrice } from "@/types/amazon.types";

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
    if (!this.priceHelper.isComplete(prices) || prices[0].adDeleted) return;
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
