import { AmazonPdpCountryScraper } from "@/marketplaces/amazon/pdp/AmazonPdpCountryScraper";
import { AmazonCountry } from "@/marketplaces/amazon/types/amazon.types";
import { AmazonAd } from "@/marketplaces/amazon/types/amazon.types";

export class AmazonPdpScraper {
  private countryScraper;

  constructor(countryScraper: AmazonPdpCountryScraper) {
    this.countryScraper = countryScraper;
  }

  execute(ad: AmazonAd, countries: AmazonCountry[]) {
    const prices = countries.map((country) => ({
      country,
      pending: false,
      complete: false,
      deleted: false,
      adDeleted: false,
      abandoned: false,
      failed: 0,
    }));

    return new Promise<void>((resolve) => {
      prices.forEach((price) => {
        this.countryScraper.execute(price, ad, prices, resolve);
      });
    });
  }
}
