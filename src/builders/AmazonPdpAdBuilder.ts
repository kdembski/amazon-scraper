import { AmazonPdpAdPriceBuilder } from "@/builders/AmazonPdpAdPriceBuilder";
import { Country, AmazonAd } from "@/types/amazon.types";

export class AmazonPdpAdBuilder {
  private priceBuilder;

  constructor(priceBuilder = new AmazonPdpAdPriceBuilder()) {
    this.priceBuilder = priceBuilder;
  }

  build(document: Document) {
    const form = document.querySelector("form");
    const isCaptcha =
      form?.getAttribute("action") === "/errors/validateCaptcha";

    if (isCaptcha) {
      console.warn("Warning: Captcha triggered!");
      return;
    }

    const price = this.priceBuilder.build(document);
    const asin = this.getAsin(document);

    return {
      price,
      asin,
      isCaptcha,
    };
  }

  private getAsin(document: Document) {
    const els = document.querySelectorAll(`[data-csa-c-asin]`);
    const asins = [...els]
      .map((el) => el.getAttribute("data-csa-c-asin"))
      .filter((asin): asin is string => !!asin);

    return asins[0];
  }

  buildUrl(country: Country, ad: AmazonAd) {
    const url = `${country.code}/dp/${ad.asin}`;
    const referer = `${country.code}/s?k=${ad.asin}`;

    return {
      url,
      referer,
    };
  }
}
