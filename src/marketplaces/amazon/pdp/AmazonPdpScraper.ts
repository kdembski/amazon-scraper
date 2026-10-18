import { AmazonPdpCountryScraper } from "@/marketplaces/amazon/pdp/AmazonPdpCountryScraper";
import { Country } from "@/shared/types/Country";
import { AmazonAd } from "@/marketplaces/amazon/types/amazon.types";

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
    }));

    return new Promise<void>((resolve) => {
      prices.forEach((price) => {
        this.countryScraper.execute(price, ad, prices, resolve);
      });
    });
  }
}
