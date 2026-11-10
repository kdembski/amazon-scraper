import type { Document, Element } from "domhandler";
import {
  AmazonAd,
  AmazonAdBuilder,
  AmazonAdBuildResult,
} from "@/marketplaces/amazon/types/amazon.types";
import { AmazonCountry } from "@/marketplaces/amazon/types/amazon.types";
import { AmazonDispatchFromNormalizer } from "@/marketplaces/amazon/pdp/builders/AmazonDispatchFromNormalizer";
import { AmazonPriceParser } from "@/marketplaces/amazon/pdp/builders/AmazonPriceParser";
import { find, text } from "@/shared/utils/html";

const CONTAINER = 'id="aod-container"';
const PINNED = 'id="aod-pinned-offer"';
const FILTER = 'id="aod-filter"';
const PRICE_BOX = 'id="aod-price-';
const MIDDLE = 'id="mir-layout-DELIVERY_BLOCK"';
const SHIPS_FROM = 'id="aod-offer-shipsFrom"';

export class AmazonAodAdBuilder implements AmazonAdBuilder {
  constructor(
    private priceParser = new AmazonPriceParser(),
    private dispatchFromNormalizer = new AmazonDispatchFromNormalizer()
  ) {}

  // Keeps only the pinned offer (inside an empty aod container when the page
  // has one): cuts the header before it, the filters and other offers after it
  trimHtml(html: string) {
    const pinned = html.indexOf(PINNED);
    const filter = html.indexOf(FILTER, Math.max(pinned, 0));
    const end = filter === -1 ? html.length : html.lastIndexOf("<", filter);
    if (pinned === -1) return html.slice(0, end);

    const offer = this.cutMiddle(html.slice(html.lastIndexOf("<", pinned), end));

    return html.lastIndexOf(CONTAINER, pinned) === -1 ? offer : `<div ${CONTAINER}>${offer}</div>`;
  }

  build(document: Document): AmazonAdBuildResult {
    const isValid = !!find("#aod-container", document);
    const pinned = find("#aod-pinned-offer", document);
    const priceBox = pinned && find("[id^='aod-price-']", pinned);

    // Pinned offer without a price box means "no featured offers available"
    if (!isValid || !pinned || !priceBox) {
      return { isValid };
    }

    return {
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

  // Cuts delivery, cart buttons and quantity between the price box and the shipper row
  private cutMiddle(offer: string) {
    const priceBox = offer.indexOf(PRICE_BOX);
    const middle = offer.indexOf(MIDDLE, priceBox);
    const shipsFrom = offer.indexOf(SHIPS_FROM, middle);
    if (priceBox === -1 || middle === -1 || shipsFrom === -1) return offer;

    return offer.slice(0, offer.lastIndexOf("<", middle)) + offer.slice(offer.lastIndexOf("<", shipsFrom));
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
