import type { Document, Element } from "domhandler";
import {
  AmazonAd,
  AmazonAdBuilder,
  AmazonAdBuildResult,
  AmazonCountry,
} from "@/marketplaces/amazon/types/amazon.types";
import { getOfferPrice, normalizeDispatchFrom } from "@/marketplaces/amazon/pdp/amazonOffer";
import { find, findAll, text } from "@/shared/utils/html";

const SUBSCRIPTION_ROWS = ["snsAccordionRowMiddle", "subscriptionPrice"];
const BUYBOX_PART = '"FeatureName" : "desktop_buybox"';
// shortcut: whole response downloaded (~320 KB vs ~90 KB cut) to keep keep-alive; set true to cut after the buy box
const CUT_RESPONSE = false;

export class AmazonTwisterAdBuilder implements AmazonAdBuilder {
  stopAt = CUT_RESPONSE ? [BUYBOX_PART, "&&&"] : undefined;

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
    const form = find("form", document);
    const isCaptcha = form?.attribs.action === "/errors/validateCaptcha";

    if (isCaptcha) {
      console.warn("Warning: Captcha triggered!");
      return { isCaptcha };
    }

    const buybox = find("#desktop_buybox", document);
    const isValid = !!buybox && !find("#priceNotAvailable", buybox);
    const priceToPay = buybox && this.getPriceToPay(buybox);

    if (!isValid || !priceToPay) {
      return { isCaptcha, isValid };
    }

    return {
      isCaptcha,
      isValid,
      price: getOfferPrice(priceToPay.parent as Element),
      dispatchFrom: this.getDispatchFrom(buybox),
    };
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

  private getPriceToPay(buybox: Element) {
    return findAll(".apex-pricetopay-value", buybox).find(
      (element) => !this.isSubscription(element, buybox)
    );
  }

  private isSubscription(element: Element, buybox: Element) {
    for (let node = element.parent; node && node !== buybox; node = node.parent) {
      if (SUBSCRIPTION_ROWS.includes((node as Element).attribs?.id)) return true;
    }
    return false;
  }

  private getDispatchFrom(buybox: Element) {
    const message = (name: string) =>
      text(
        find(
          `[offer-display-feature-name='${name}'] .offer-display-feature-text-message`,
          buybox
        )
      );

    return normalizeDispatchFrom(
      message("desktop-fulfiller-info") || message("desktop-merchant-info")
    );
  }
}
