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
    const dispatchFrom = this.getDispatchFrom(document);

    return {
      price,
      asin,
      isCaptcha,
      dispatchFrom,
    };
  }

  private getAsin(document: Document) {
    const els = document.querySelectorAll(`[data-csa-c-asin]`);
    const asins = [...els]
      .map((el) => el.getAttribute("data-csa-c-asin"))
      .filter((asin): asin is string => !!asin);

    return asins[0];
  }

  private getDispatchFrom(document: Document) {
    const fulfillerSelector =
      "#fulfillerInfoFeature_feature_div .offer-display-feature-text-message";
    const merchantSelector =
      "#merchantInfoFeature_feature_div .offer-display-feature-text-message";

    const fulfiller = document.querySelector(fulfillerSelector)?.textContent;
    const merchant = document.querySelector(merchantSelector)?.textContent;

    return fulfiller || merchant;
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
