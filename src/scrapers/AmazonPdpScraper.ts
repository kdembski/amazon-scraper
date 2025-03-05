import { AmazonPdpAdBuilder } from "@/builders/AmazonPdpAdBuilder";
import { AmazonPdpCountryScraper } from "@/scrapers/AmazonPdpCountryScraper";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import { AmazonAd, Country, AmazonAdPrice } from "@/types/amazon.types";
import { parseHTML } from "linkedom";

export class AmazonPdpScraper {
  private countryScraper;

  constructor(
    failed: Record<string, number>,
    countryScraper = new AmazonPdpCountryScraper(failed)
  ) {
    this.countryScraper = countryScraper;
  }

  execute(ad: AmazonAd, countries: Country[]) {
    const prices = countries.map((country) => ({
      country,
      pending: false,
      complete: false,
      deleted: false,
      failed: 0,
    }));

    return new Promise<void>((resolve) => {
      countries.forEach((country) => {
        this.countryScraper.execute(country, ad, prices, resolve);
      });
    });
  }
}
