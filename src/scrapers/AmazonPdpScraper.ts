import { AmazonPdpCountryScraper } from "@/scrapers/abstract/AmazonPdpCountryScraper";
import { AmazonAd, Country } from "@/types/amazon.types";

export class AmazonPdpScraper {
  private countryScraper;

  constructor(countryScraper: AmazonPdpCountryScraper) {
    this.countryScraper = countryScraper;
  }

  execute(ad: AmazonAd, countries: Country[]) {
    const prices = countries.map((country) => ({
      country,
      pending: false,
      complete: false,
      deleted: false,
      adDeleted: false,
      failed: 0,
      missingData: 0,
    }));

    return new Promise<void>((resolve) => {
      prices.forEach((price) => {
        this.countryScraper.execute(price, ad, prices, resolve);
      });
    });
  }
}
