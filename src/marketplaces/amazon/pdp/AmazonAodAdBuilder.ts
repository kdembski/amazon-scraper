import {
  AmazonAd,
  AmazonAdBuilder,
  AmazonAdBuildResult,
} from "@/marketplaces/amazon/types/amazon.types";
import { AmazonCountry } from "@/marketplaces/amazon/types/amazon.types";

export class AmazonAodAdBuilder implements AmazonAdBuilder {
  // Cuts the filters and the other offers that follow the pinned offer
  trimHtml(html: string) {
    const filter = html.indexOf('id="aod-filter"');
    if (filter === -1) return html;

    return html.slice(0, html.lastIndexOf("<", filter));
  }

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

  buildUrl(country: AmazonCountry, ad: AmazonAd) {
    const url = `${country.tld}/gp/product/ajax/aodAjaxMain/?asin=${ad.asin}&pc=dp`;
    const referer = `${country.tld}/dp/${ad.asin}`;

    return {
      url,
      referer,
    };
  }

  private getPrice(priceBox: Element) {
    const container =
      priceBox.querySelector(".apex-pricetopay-value") ??
      priceBox.querySelector(".a-price");

    // The whole part ends with the marketplace's decimal separator ("12," or "12.")
    const whole = this.getDigits(
      container?.querySelector(".a-price-whole")?.textContent
    );
    const fraction = this.getDigits(
      container?.querySelector(".a-price-fraction")?.textContent
    );

    if (whole && fraction) {
      return this.parse(`${whole}.${fraction}`);
    }

    // .a-offscreen is usually empty in this fragment, so the accessibility
    // label goes first
    return (
      this.parseLabel(
        priceBox.querySelector(".apex-pricetopay-accessibility-label")
          ?.textContent
      ) ??
      this.parseLabel(container?.querySelector(".a-offscreen")?.textContent)
    );
  }

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

  private getDigits(text: string | null | undefined) {
    return text?.replace(/\D/g, "");
  }

  // "19,99 €", "€1,299.00", "1.299 €": a separator followed by one or two
  // digits at the end is the decimal one, any other separates thousands
  private parseLabel(label: string | null | undefined) {
    const price = label?.replace(/[^\d.,]/g, "") ?? "";
    const [, whole, fraction = "0"] = price.match(/^(.*?)(?:[.,](\d{1,2}))?$/)!;
    const digits = this.getDigits(whole);

    if (!digits) return;
    return this.parse(`${digits}.${fraction}`);
  }

  private parse(value: string) {
    return parseFloat(parseFloat(value).toFixed(2));
  }
}
