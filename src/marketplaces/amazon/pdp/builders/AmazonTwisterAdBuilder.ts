import type { Document } from "domhandler";
import {
  AmazonAd,
  AmazonAdBuilder,
  AmazonAdBuildResult,
  AmazonCountry,
} from "@/marketplaces/amazon/types/amazon.types";
import { AmazonBuyboxParser } from "@/marketplaces/amazon/pdp/builders/AmazonBuyboxParser";
import { AmazonCaptchaDetector } from "@/marketplaces/amazon/pdp/builders/AmazonCaptchaDetector";
import { find } from "@/shared/utils/html";

const BUYBOX_PART = '"FeatureName" : "desktop_buybox"';
// shortcut: whole response downloaded (~320 KB vs ~90 KB cut) to keep keep-alive; set true to cut after the buy box
const CUT_RESPONSE = false;

export class AmazonTwisterAdBuilder implements AmazonAdBuilder {
  stopAt = CUT_RESPONSE ? [BUYBOX_PART, "&&&"] : undefined;
  notFoundIsNoData = true;

  constructor(
    private captchaDetector = new AmazonCaptchaDetector(),
    private buyboxParser = new AmazonBuyboxParser()
  ) {}

  // Takes the buy box out of the JSON parts of the response
  trimHtml(html: string) {
    const start = html.indexOf(BUYBOX_PART);
    if (start === -1) return html;

    const end = html.indexOf("&&&", start);
    const part = html.slice(
      html.lastIndexOf("{", start),
      end === -1 ? undefined : end
    );
    const buybox = JSON.parse(part).Value.content.desktop_buybox;

    return `<div id="desktop_buybox">${buybox}</div>`;
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
