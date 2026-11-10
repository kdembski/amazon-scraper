import type { Element } from "domhandler";
import _ from "lodash";
import type { AmazonAdBuildResult } from "@/marketplaces/amazon/types/amazon.types";
import { AmazonDispatchFromNormalizer } from "@/marketplaces/amazon/pdp/builders/AmazonDispatchFromNormalizer";
import { AmazonPriceParser } from "@/marketplaces/amazon/pdp/builders/AmazonPriceParser";
import { find, findAll, text } from "@/shared/utils/html";

const SUBSCRIPTION_ROWS = ["snsAccordionRowMiddle", "subscriptionPrice"];
const CART_PRICE = "input[name='items[0.base][customerVisiblePrice][amount]']";
const MIDDLE = 'id="deliveryBlockContainer"';
const OFFER_ROWS = ["desktop-fulfiller-info", "desktop-merchant-info"].map(
  (name) => `offer-display-feature-name="${name}"`
);
// Layouts whose price may sit after the middle: kept whole
const KEEP_WHOLE = ["priceNotAvailable", ...SUBSCRIPTION_ROWS];

// Product page buy box (twister fragment, gp/aw/d)
export class AmazonBuyboxParser {
  constructor(
    private priceParser = new AmazonPriceParser(),
    private dispatchFromNormalizer = new AmazonDispatchFromNormalizer()
  ) {}

  // Cuts the middle of the buy box html (delivery, quantity, cart buttons)
  // between the price and the offer rows with the shipper
  trim(html: string) {
    if (KEEP_WHOLE.some((marker) => html.includes(marker))) return html;

    const middle = html.indexOf(MIDDLE);
    const rows = _.min(OFFER_ROWS.map((row) => html.indexOf(row)).filter((index) => index !== -1));
    if (middle === -1 || rows === undefined || rows < middle) return html;

    return html.slice(0, html.lastIndexOf("<", middle)) + html.slice(html.lastIndexOf("<", rows));
  }

  parse(buybox: Element | null | undefined): AmazonAdBuildResult {
    const isValid = !!buybox && !find("#priceNotAvailable", buybox);
    const price = buybox && this.getPrice(buybox);

    if (!isValid || !price) {
      return { isValid };
    }

    return {
      isValid,
      price,
      dispatchFrom: this.getDispatchFrom(buybox),
    };
  }

  private getPrice(buybox: Element) {
    const priceToPay = findAll(".apex-pricetopay-value", buybox).find(
      (element) => !this.isSubscription(element, buybox)
    );
    if (priceToPay) return this.priceParser.parse(priceToPay.parent as Element);

    return Number(find(CART_PRICE, buybox)?.attribs.value) || undefined;
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

    return this.dispatchFromNormalizer.normalize(
      message("desktop-fulfiller-info") || message("desktop-merchant-info")
    );
  }
}
