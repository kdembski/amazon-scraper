import { AmazonPdpAdBuilder } from "@/builders/AmazonPdpAdBuilder";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import { AmazonAd, Country, AmazonAdPrice } from "@/types/amazon.types";
import { parseHTML } from "linkedom";

export class AmazonPdpScraper {
  private baseUrl = "https://www.amazon";
  private apiService;
  private amazonService;
  private ad: AmazonAd;
  private countries: Country[];
  private prices?: AmazonAdPrice[];

  constructor(
    ad: AmazonAd,
    countries: Country[],
    apiService = ApiService.getInstance(),
    amazonService = AmazonService.getInstance()
  ) {
    this.ad = ad;
    this.countries = countries;
    this.apiService = apiService;
    this.amazonService = amazonService;
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
    const { document } = parseHTML(data);
    const builder = new AmazonPdpAdBuilder().build(document);

    if (builder.isCaptcha) {
      price.pending = false;
      this.handleCountry(country, resolve);
      return;
    }

    price.value = builder.ad?.price;
    price.complete = true;

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

      this.prices?.forEach((price) => (price.deleted = true));
      resolve();
      return;
    }

    if (price.failed > 50) {
      price.complete = true;
      this.amazonService.queueService.failed++;
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
}
