import type { Document } from "domhandler";
import {
  AmazonAd,
  AmazonAdBuilder,
  AmazonAdBuildResult,
  AmazonCountry,
} from "@/marketplaces/amazon/types/amazon.types";
import { buildBuybox, isCaptchaPage } from "@/marketplaces/amazon/pdp/amazonOffer";
import { find } from "@/shared/utils/html";

const BUYBOX = 'id="buybox"';

export class AmazonAwdAdBuilder implements AmazonAdBuilder {
  // Cuts the header and the related products that come before the buy box
  trimHtml(html: string) {
    const start = html.indexOf(BUYBOX);
    if (start === -1) return html;

    return html.slice(html.lastIndexOf("<", start));
  }

  build(document: Document): AmazonAdBuildResult {
    if (isCaptchaPage(document)) {
      console.warn("Warning: Captcha triggered!");
      return { isCaptcha: true };
    }

    return buildBuybox(find("#buybox", document));
  }

  buildUrl(country: AmazonCountry, ad: AmazonAd) {
    return {
      url: `${country.tld}/gp/aw/d/${ad.asin}?th=1&psc=1`,
      referer: `${country.tld}/`,
    };
  }
}
