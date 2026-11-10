import type { Document } from "domhandler";
import {
  AmazonAd,
  AmazonAdBuilder,
  AmazonAdBuildResult,
  AmazonCountry,
} from "@/marketplaces/amazon/types/amazon.types";
import { AmazonBuyboxParser } from "@/marketplaces/amazon/pdp/builders/AmazonBuyboxParser";
import type { StopAt } from "@/shared/http/http.types";
import { find } from "@/shared/utils/html";

const BUYBOX = 'id="buybox"';
const AFTER_BUYBOX = 'id="olpLinkWidget_feature_div"';
// First buy box row after the shipper (not the "-collapsed" accordion header)
const AFTER_SHIPPER = 'desktop-return-info"';

export class AmazonAwdAdBuilder implements AmazonAdBuilder {
  stopAt: StopAt = [BUYBOX, [AFTER_SHIPPER, AFTER_BUYBOX]];

  constructor(private buyboxParser = new AmazonBuyboxParser()) {}

  // Cuts the header and the related products that come before the buy box
  // and the middle of the buy box
  trimHtml(html: string) {
    const start = html.indexOf(BUYBOX);
    if (start === -1) return html;

    return this.buyboxParser.trim(html.slice(html.lastIndexOf("<", start)));
  }

  build(document: Document): AmazonAdBuildResult {
    return this.buyboxParser.parse(find("#buybox", document));
  }

  buildUrl(country: AmazonCountry, ad: AmazonAd) {
    return {
      url: `${country.tld}/gp/aw/d/${ad.asin}?th=1&psc=1`,
      referer: `${country.tld}/`,
    };
  }
}
