import { AmazonPdpAdBuilder } from "@/builders/AmazonPdpAdBuilder";
import { AmazonPdpPriceHelper } from "@/scrapers/AmazonPdpPriceHelper";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import { AmazonAd, Country, AmazonAdPrice } from "@/types/amazon.types";
import { parseHTML } from "linkedom";

export class AmazonPdpCountryScraper {
  private baseUrl = "https://www.amazon";
  private apiService;
  private amazonService;
  private builder;
  private priceHelper;
  private failed: Record<string, number>;

  constructor(
    failed: Record<string, number>,
    apiService = ApiService.getInstance(),
    amazonService = AmazonService.getInstance(),
    builder = new AmazonPdpAdBuilder(),
    priceHelper = new AmazonPdpPriceHelper()
  ) {
    this.failed = failed;
    this.apiService = apiService;
    this.amazonService = amazonService;
    this.builder = builder;
    this.priceHelper = priceHelper;
  }

  execute(
    country: Country,
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolve: () => void
  ) {
    const price = this.priceHelper.getPrice(prices, country.id);

    if (!price) return;
    if (price.complete || price.pending || price.deleted) return;

    const url = `${this.baseUrl}.${country.code}/dp/${ad.asin}`;
    const referer = `${this.baseUrl}.${country.code}/s?k=${ad.asin}"`;
    price.pending = true;

    this.amazonService.get<string>(url, referer, {
      onSuccess: (res) =>
        this.onSuccess(res, country, price, ad, prices, resolve),
      onError: (e) => this.onError(e, country, price, ad, prices, resolve),
    });
  }

  private async onSuccess(
    data: string,
    country: Country,
    price: AmazonAdPrice,
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolve: () => void
  ) {
    price.pending = false;

    if (!data.length) {
      this.retry(country, ad, prices, resolve);
      return;
    }

    const { document } = parseHTML(data);
    const pdpAd = this.builder.build(document);

    if (pdpAd?.isCaptcha) {
      this.retry(country, ad, prices, resolve);
      return;
    }

    price.value = this.standarizePrice(country, pdpAd);
    price.complete = true;
    this.amazonService.queueService.completed++;
    this.complete(ad, prices, resolve);
  }

  private onError(
    e: any,
    country: Country,
    price: AmazonAdPrice,
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolve: () => void
  ) {
    price.pending = false;

    if (e.status === 404) {
      this.delete(ad, price, prices, resolve);
      return;
    }

    this.failed[country.code]++;

    if (price.failed > 100) {
      price.complete = true;
      this.amazonService.queueService.failed++;
      this.complete(ad, prices, resolve);
      return;
    }

    price.failed++;
    this.retry(country, ad, prices, resolve);
  }

  private retry(
    country: Country,
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolve: () => void
  ) {
    this.execute(country, ad, prices, resolve);
  }

  private complete(ad: AmazonAd, prices: AmazonAdPrice[], resolve: () => void) {
    if (!this.priceHelper.isComplete(prices)) return;
    this.priceHelper.sendCompletedPrices(prices, ad);
    resolve();
  }

  private delete(
    ad: AmazonAd,
    price: AmazonAdPrice,
    prices: AmazonAdPrice[],
    resolve: () => void
  ) {
    if (!price.deleted) {
      this.apiService.delete("amazon/ads/" + ad.id);
    }

    prices?.forEach((price) => {
      if (price.deleted) return;
      price.deleted = true;
      this.amazonService.queueService.completed++;
    });
    resolve();
  }

  private standarizePrice(
    country: Country,
    pdpAd?: {
      price: number | undefined;
      deliverCode: string | undefined;
    }
  ) {
    if (!pdpAd?.price) return;

    const multiplier = this.priceHelper.getPriceMultiplier(
      country.code,
      pdpAd?.deliverCode
    );
    return pdpAd.price * multiplier;
  }
}
