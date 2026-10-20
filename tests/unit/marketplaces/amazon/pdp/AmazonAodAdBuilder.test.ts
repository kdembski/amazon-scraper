import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmazonAodAdBuilder } from "@/marketplaces/amazon/pdp/AmazonAodAdBuilder";
import { captchaPage, toDocument } from "@@tests/support/html";
import { AmazonCountry } from "@/marketplaces/amazon/types/amazon.types";
import { AmazonAd } from "@/marketplaces/amazon/types/amazon.types";

const builder = new AmazonAodAdBuilder();
const build = (body: string) => builder.build(toDocument(body));

const priceToPay = ({
  whole = "24",
  fraction = "99",
  offscreen = "",
} = {}) => `
  <span class="a-price apex-pricetopay-value">
    <span class="a-offscreen">${offscreen}</span>
    <span aria-hidden="true">
      <span class="a-price-whole">${whole}<span class="a-price-decimal">,</span></span>
      <span class="a-price-fraction">${fraction}</span>
    </span>
  </span>
`;

const shipsFrom = (right: string) => `
  <div id="aod-offer-shipsFrom">
    <div class="a-col-left"><span>Versand</span></div>
    <div class="a-col-right">${right}</div>
  </div>
`;

const aodPage = (priceBox: string, extra = "") => `
  <div id="aod-container">
    <div id="aod-pinned-offer">
      ${priceBox ? `<div id="aod-price-0">${priceBox}</div>` : ""}
      ${extra}
    </div>
  </div>
`;

describe("AmazonAodAdBuilder", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects a captcha page", () => {
    expect(build(captchaPage)).toEqual({ isCaptcha: true });
  });

  it("marks a response without the aod container as invalid", () => {
    expect(build(`<div id="something-else"></div>`)).toEqual({
      isCaptcha: false,
      isValid: false,
    });
  });

  it("returns no price when the pinned offer has no price box", () => {
    expect(build(aodPage(""))).toEqual({ isCaptcha: false, isValid: true });
  });

  it("returns no price when there is no pinned offer", () => {
    expect(build(`<div id="aod-container"></div>`)).toEqual({
      isCaptcha: false,
      isValid: true,
    });
  });

  it("reads whole and fraction from the price to pay", () => {
    const body = aodPage(
      priceToPay({ whole: "1.299", fraction: "00" }),
      shipsFrom(`<span class="a-size-small">Amazon</span>`)
    );

    expect(build(body)).toEqual({
      isCaptcha: false,
      isValid: true,
      price: 1299,
      dispatchFrom: "Amazon",
    });
  });

  it("falls back to a plain .a-price container", () => {
    const body = aodPage(`
      <span class="a-price">
        <span class="a-price-whole">9,</span><span class="a-price-fraction">49</span>
      </span>
    `);
    expect(build(body).price).toBe(9.49);
  });

  it("falls back to the accessibility label when the fraction is missing", () => {
    const body = aodPage(`
      ${priceToPay({ fraction: "" })}
      <span class="apex-pricetopay-accessibility-label">19,99 €</span>
    `);
    expect(build(body).price).toBe(19.99);
  });

  it("falls back to .a-offscreen when there is no accessibility label", () => {
    const body = aodPage(priceToPay({ fraction: "", offscreen: "17,50 €" }));
    expect(build(body).price).toBe(17.5);
  });

  it("returns no price when the price box is empty", () => {
    const body = aodPage(`<span class="a-price"></span>`);
    expect(build(body).price).toBeUndefined();
  });

  it("normalizes whitespace in dispatchFrom", () => {
    const body = aodPage(
      priceToPay(),
      shipsFrom(`<span class="a-size-small">\n   Amazon   EU \n </span>`)
    );
    expect(build(body).dispatchFrom).toBe("Amazon EU");
  });

  it("reads dispatchFrom from the column itself without a small span", () => {
    const body = aodPage(priceToPay(), shipsFrom(" Some Seller "));
    expect(build(body).dispatchFrom).toBe("Some Seller");
  });

  it("leaves dispatchFrom undefined when the row is missing or empty", () => {
    expect(build(aodPage(priceToPay())).dispatchFrom).toBeUndefined();
    expect(
      build(aodPage(priceToPay(), shipsFrom("  "))).dispatchFrom
    ).toBeUndefined();
  });

  it("builds the aod ajax url with the product page as referer", () => {
    const country = { countryId: 7, tld: "com.be" } as AmazonCountry;
    const ad = { id: 1, asin: "B0TESTASIN" } as AmazonAd;

    expect(builder.buildUrl(country, ad)).toEqual({
      url: "com.be/gp/product/ajax/aodAjaxMain/?asin=B0TESTASIN&pc=dp",
      referer: "com.be/dp/B0TESTASIN",
    });
  });
});
