import {
  AmazonAd,
  AmazonAdBuilder,
  AmazonAdBuildResult,
} from "@/types/amazon.types";
import { Country } from "@/shared/types/Country";

// Builds price data from the "All Offers Display" ajax fragment
// (/gp/product/ajax/aodAjaxMain). Its pinned offer is the same featured
// offer that the product page shows in the buy box, at ~3% of the transfer.
export class AmazonAodAdBuilder implements AmazonAdBuilder {
  build(document: Document): AmazonAdBuildResult {
    const form = document.querySelector("form");
    const isCaptcha =
      form?.getAttribute("action") === "/errors/validateCaptcha";

    if (isCaptcha) {
      console.warn("Warning: Captcha triggered!");
      return { isCaptcha };
    }

    const isValid = !!document.querySelector("#aod-container");
    const pinned = document.querySelector("#aod-pinned-offer");
    const priceBox = pinned?.querySelector("[id^='aod-price-']");

    // Pinned offer without a price box means "no featured offers available"
    if (!isValid || !pinned || !priceBox) {
      return { isCaptcha, isValid };
    }

    return {
      isCaptcha,
      isValid,
      price: this.getPrice(priceBox),
      dispatchFrom: this.getDispatchFrom(pinned),
    };
  }

  buildUrl(country: Country, ad: AmazonAd) {
    const url = `${country.code}/gp/product/ajax/aodAjaxMain/?asin=${ad.asin}&pc=dp`;
    const referer = `${country.code}/dp/${ad.asin}`;

    return {
      url,
      referer,
    };
  }

  private getPrice(priceBox: Element) {
    const container =
      priceBox.querySelector(".apex-pricetopay-value") ??
      priceBox.querySelector(".a-price");

    const whole = this.cleanUpPrice(
      container?.querySelector(".a-price-whole")?.textContent
    );
    const fraction = this.cleanUpPrice(
      container?.querySelector(".a-price-fraction")?.textContent
    );

    if (whole && fraction) {
      return this.parse(`${whole}${fraction}`);
    }

    // .a-offscreen is usually empty in this fragment, so the accessibility
    // label goes first
    const price =
      this.cleanUpPrice(
        priceBox.querySelector(".apex-pricetopay-accessibility-label")
          ?.textContent
      ) ||
      this.cleanUpPrice(container?.querySelector(".a-offscreen")?.textContent);

    if (!price) return;
    return this.parse(price);
  }

  // Equivalent of the "Ships from" row in the product page buy box
  private getDispatchFrom(pinned: Element) {
    const row = pinned.querySelector("#aod-offer-shipsFrom");
    const value =
      row?.querySelector(".a-col-right .a-size-small") ??
      row?.querySelector(".a-col-right");
    const dispatchFrom = value?.textContent?.replace(/\s+/g, " ").trim();

    // Some marketplaces (e.g. nl) name Amazon by its domain here, while the
    // product page and the backend use plain "Amazon"
    if (dispatchFrom && /^amazon(\.[a-z]{2,3})+$/i.test(dispatchFrom)) {
      return "Amazon";
    }

    return dispatchFrom || undefined;
  }

  private cleanUpPrice(price: string | null | undefined) {
    return price?.replace(/[^\d,]/g, "").replace(",", ".");
  }

  private parse(value: string) {
    return parseFloat(parseFloat(value).toFixed(2));
  }
}
