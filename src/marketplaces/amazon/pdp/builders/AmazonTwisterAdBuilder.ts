import type { Document } from "domhandler";
import {
  AmazonAd,
  AmazonAdBuilder,
  AmazonAdBuildResult,
  AmazonCountry,
} from "@/marketplaces/amazon/types/amazon.types";
import { AmazonBuyboxParser } from "@/marketplaces/amazon/pdp/builders/AmazonBuyboxParser";
import { AmazonCaptchaDetector } from "@/marketplaces/amazon/AmazonCaptchaDetector";
import type { StopAt } from "@/shared/http/http.types";
import { find } from "@/shared/utils/html";

const BUYBOX_PART = '"FeatureName" : "desktop_buybox"';
const BUYBOX_VALUE = /"desktop_buybox"\s*:\s*"/;
// First buy box feature after the price and the shipper, as an escaped JSON
// attribute value (not the "-collapsed" one of the accordion header)
const AFTER_SHIPPER = 'desktop-return-info\\"';

export class AmazonTwisterAdBuilder implements AmazonAdBuilder {
  stopAt: StopAt = [BUYBOX_PART, [AFTER_SHIPPER, "&&&"]];
  notFoundIsNoData = true;

  constructor(
    private captchaDetector = new AmazonCaptchaDetector(),
    private buyboxParser = new AmazonBuyboxParser()
  ) {}

  // Takes the buy box out of the JSON parts of the response, also when the
  // download stopped inside it
  trimHtml(html: string) {
    const start = html.indexOf(BUYBOX_PART);
    if (start === -1) return html;

    const value = html.slice(start).match(BUYBOX_VALUE);
    if (!value) return html;

    const buybox = this.decode(html.slice(start + value.index! + value[0].length));

    return `<div id="desktop_buybox">${buybox}</div>`;
  }

  // JSON string up to its closing quote or to the end of the text, without an
  // escape sequence cut in half
  private decode(json: string) {
    let end = 0;
    while (end < json.length && json[end] !== '"') {
      end += json[end] !== "\\" ? 1 : json[end + 1] === "u" ? 6 : 2;
    }

    return JSON.parse(`"${json.slice(0, end > json.length ? json.lastIndexOf("\\") : end)}"`);
  }

  build(document: Document): AmazonAdBuildResult {
    if (this.captchaDetector.detect(document)) {
      return { isCaptcha: true };
    }

    return this.buyboxParser.parse(find("#desktop_buybox", document));
  }

  buildUrl(country: AmazonCountry, ad: AmazonAd) {
    const query = [
      `asinList=${ad.asin}`,
      `id=${ad.asin}`,
      `parentAsin=${ad.asin}`,
      "mType=full&json=1&isUDPFlag=1&dpxAjaxFlag=1&isFlushing=2&psc=1",
    ].join("&");

    return {
      url: `${country.tld}/gp/twister/ajaxv2?${query}`,
      referer: `${country.tld}/dp/${ad.asin}`,
    };
  }
}
