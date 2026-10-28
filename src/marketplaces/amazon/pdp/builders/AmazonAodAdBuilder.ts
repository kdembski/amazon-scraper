import type { Document, Element } from "domhandler";
import {
  AmazonAd,
  AmazonAdBuilder,
  AmazonAdBuildResult,
} from "@/marketplaces/amazon/types/amazon.types";
import { AmazonCountry } from "@/marketplaces/amazon/types/amazon.types";
import { AmazonCaptchaDetector } from "@/marketplaces/amazon/pdp/builders/AmazonCaptchaDetector";
import { AmazonDispatchFromNormalizer } from "@/marketplaces/amazon/pdp/builders/AmazonDispatchFromNormalizer";
import { AmazonPriceParser } from "@/marketplaces/amazon/pdp/builders/AmazonPriceParser";
import { find, text } from "@/shared/utils/html";

export class AmazonAodAdBuilder implements AmazonAdBuilder {
  constructor(
    private readonly captchaDetector = new AmazonCaptchaDetector(),
    private readonly priceParser = new AmazonPriceParser(),
    private readonly dispatchFromNormalizer = new AmazonDispatchFromNormalizer()
  ) {}

  // Cuts the filters and the other offers that follow the pinned offer
  trimHtml(html: string) {
    const filter = html.indexOf('id="aod-filter"');
    if (filter === -1) return html;

    return html.slice(0, html.lastIndexOf("<", filter));
  }

  build(document: Document): AmazonAdBuildResult {
    const isCaptcha = this.captchaDetector.detect(document);

    if (isCaptcha) {
      return { isCaptcha };
    }

    const isValid = !!find("#aod-container", document);
    const pinned = find("#aod-pinned-offer", document);
    const priceBox = pinned && find("[id^='aod-price-']", pinned);

    // Pinned offer without a price box means "no featured offers available"
    if (!isValid || !pinned || !priceBox) {
      return { isCaptcha, isValid };
    }

    return {
      isCaptcha,
      isValid,
      price: this.priceParser.parse(priceBox),
      dispatchFrom: this.getDispatchFrom(pinned),
    };
  }

  buildUrl(country: AmazonCountry, ad: AmazonAd) {
    const url = `${country.tld}/gp/product/ajax/aodAjaxMain/?asin=${ad.asin}&pc=dp`;
    const referer = `${country.tld}/dp/${ad.asin}`;

    return {
      url,
      referer,
    };
  }

  private getDispatchFrom(pinned: Element) {
    const row = find("#aod-offer-shipsFrom", pinned);
    const value =
      row &&
      (find(".a-col-right .a-size-small", row) ??
        find(".a-col-right", row));

    return this.dispatchFromNormalizer.normalize(text(value));
  }
}
