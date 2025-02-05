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
      adId: this.ad.id,
      currencyId: country.currencyId,
      country,
      pending: false,
      complete: false,
      deleted: false,
    }));

    return new Promise<void>((resolve) => {
      this.countries.forEach((country) => {
        this.handleCountry(country, resolve);
      });
    });
  }

  private handleCountry(country: Country, resolve: () => void) {
    const { currencyId } = country;
    const price = this.getPrice(this.ad.id, currencyId);

    if (!price) return;
    if (price.complete || price.pending || price.deleted) return;

    const url = `${this.baseUrl}.${country.code}/dp/${this.ad.asin}`;
    const referer = `${this.baseUrl}.${country.code}/s?k=${this.ad.asin}"`;
    price.pending = true;

    this.amazonService.get<string>(url, referer, {
      onSuccess: (data) => this.onSuccess(data, price, resolve),
      onError: (e) => this.onError(e, country, price, resolve),
    });
  }

  private async onSuccess(
    data: string,
    price: AmazonAdPrice,
    resolve: () => void
  ) {
    const { document } = parseHTML(data);

    price.value = new AmazonPdpAdBuilder().build(document).ad?.price;
    price.complete = true;

    if (this.isComplete()) {
      this.apiService.put("amazon/ads/" + this.ad.id, {
        prices: this.prices?.filter((price) => !!price.value),
      });
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
      this.apiService.delete("amazon/ads/" + this.ad.id);
      price.deleted = true;
      resolve();
      return;
    }
    this.handleCountry(country, resolve);
  }

  private getPrice(adId: number, currencyId: number) {
    return this.prices?.find(
      (price) => price.adId === adId && price.currencyId === currencyId
    );
  }

  private isComplete() {
    return this.prices?.every((price) => price.complete);
  }
}
