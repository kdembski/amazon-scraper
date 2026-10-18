import { AmazonPdpAdPriceBuilder } from "@/builders/AmazonPdpAdPriceBuilder";
import { Country } from "@/shared/types/Country";
import { AmazonAd, AmazonAdBuilder } from "@/types/amazon.types";

export class AmazonPdpAdBuilder implements AmazonAdBuilder {
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
      return { isCaptcha };
    }

    const price = this.priceBuilder.build(document);
    const dispatchFrom = this.getDispatchFrom(document);

    return {
      price,
      isCaptcha,
      dispatchFrom,
    };
  }

  private getDispatchFrom(document: Document) {
    const fulfillerSelector =
      "#fulfillerInfoFeature_feature_div .offer-display-feature-text-message";
    const merchantSelector =
      "#merchantInfoFeature_feature_div .offer-display-feature-text-message";

    const fulfiller = document.querySelector(fulfillerSelector)?.textContent;
    const merchant = document.querySelector(merchantSelector)?.textContent;

    return fulfiller || merchant || undefined;
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
