import { AmazonPdpAdBuilder } from "@/builders/AmazonPdpAdBuilder";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import { AmazonAd, Country, AmazonAdPrice } from "@/types/amazon.types";
import { parseHTML } from "linkedom";

export class AmazonPdpScraper {
  private baseUrl = "https://www.amazon";
  private apiService;
  private amazonService;
  private builder;
  private ad: AmazonAd;
  private countries: Country[];
  private prices?: AmazonAdPrice[];
  private failed: Record<string, number>;

  constructor(
    ad: AmazonAd,
    countries: Country[],
    failed: Record<string, number>,
    apiService = ApiService.getInstance(),
    amazonService = AmazonService.getInstance(),
    builder = new AmazonPdpAdBuilder()
  ) {
    this.ad = ad;
    this.countries = countries;
    this.failed = failed;
    this.apiService = apiService;
    this.amazonService = amazonService;
    this.builder = builder;
  }

  execute() {
    this.prices = this.countries.map((country) => ({
      country,
      pending: false,
      complete: false,
      deleted: false,
      failed: 0,
    }));

    return new Promise<void>((resolve) => {
      this.countries.forEach((country) => {
        this.handleCountry(country, resolve);
      });
    });
  }

  private handleCountry(country: Country, resolve: () => void) {
    const price = this.getPrice(country.id);

    if (!price) return;
    if (price.complete || price.pending || price.deleted) return;

    const url = `${this.baseUrl}.${country.code}/dp/${this.ad.asin}`;
    const referer = `${this.baseUrl}.${country.code}/s?k=${this.ad.asin}"`;
    price.pending = true;

    this.amazonService.get<string>(url, referer, {
      onSuccess: (res) => this.onSuccess(res, country, price, resolve),
      onError: (e) => this.onError(e, country, price, resolve),
    });
  }

  private async onSuccess(
    data: string,
    country: Country,
    price: AmazonAdPrice,
    resolve: () => void
  ) {
    if (!data.length) {
      price.pending = false;
      this.handleCountry(country, resolve);
      return;
    }

    const { document } = parseHTML(data);
    const ad = this.builder.build(document);

    if (ad?.isCaptcha) {
      price.pending = false;
      this.handleCountry(country, resolve);
      return;
    }

    if (ad?.price) {
      const multiplier = this.getPriceMultiplier(country.code, ad?.deliverCode);
      price.value = ad.price * multiplier;
    }

    price.complete = true;
    this.amazonService.queueService.completed++;

    if (this.isComplete()) {
      this.sendCompletedPrices();
      resolve();
    }
  }

  private onError(
    e: any,
    country: Country,
    price: AmazonAdPrice,
    resolve: () => void
  ) {
    price.pending = false;

    if (e.status === 404) {
      if (!price.deleted) {
        this.apiService.delete("amazon/ads/" + this.ad.id);
      }

      this.prices?.forEach((price) => {
        if (price.deleted) return;
        price.deleted = true;
        this.amazonService.queueService.completed++;
      });
      resolve();
      return;
    }

    this.failed[country.code]++;

    if (price.failed > 100) {
      price.complete = true;
      this.amazonService.queueService.failed++;

      if (this.isComplete()) {
        this.sendCompletedPrices();
        resolve();
      }

      return;
    }

    price.failed++;
    this.handleCountry(country, resolve);
  }

  private getPrice(countryId: number) {
    return this.prices?.find((price) => price.country.id === countryId);
  }

  private isComplete() {
    return this.prices?.every((price) => price.complete);
  }

  private sendCompletedPrices() {
    const prices = this.prices
      ?.filter((price) => !!price.value)
      .map((price) => ({
        adId: this.ad.id,
        countryId: price.country.id,
        country: price.country,
        value: price.value,
      }));

    if (!prices?.length) return;

    this.apiService.put("amazon/ads/" + this.ad.id, { prices });
  }

  private getPriceMultiplier(countryCode: string, deliveryCode?: string) {
    if (!deliveryCode) return 1;
    const multipliers: Record<string, any> = {
      fr: {
        ca: 1.2,
      },
      it: {
        ca: 1.22,
      },
      de: {
        ca: 1.23,
      },
    };

    return (multipliers[countryCode][deliveryCode] as number) || 1;
  }
}
