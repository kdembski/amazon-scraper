import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmazonPdpAdBuilder } from "@/builders/AmazonPdpAdBuilder";
import { aPrice, captchaPage, toDocument } from "@@tests/support/html";
import { Country } from "@/shared/types/Country";
import { AmazonAd } from "@/types/amazon.types";

const builder = new AmazonPdpAdBuilder();
const build = (body: string) => builder.build(toDocument(body));

const offerText = (featureId: string, text: string) => `
  <div id="${featureId}_feature_div">
    <span class="offer-display-feature-text-message">${text}</span>
  </div>
`;

describe("AmazonPdpAdBuilder", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects a captcha page", () => {
    expect(build(captchaPage)).toEqual({ isCaptcha: true });
  });

  it("does not treat other forms as a captcha", () => {
    const result = build(`<form action="/cart/add-to-cart"></form>`);
    expect(result.isCaptcha).toBe(false);
  });

  it("builds price and dispatchFrom from a product page", () => {
    const body = `
      <div id="corePriceDisplay_desktop_feature_div">${aPrice("24", "99")}</div>
      ${offerText("fulfillerInfoFeature", "Amazon")}
      ${offerText("merchantInfoFeature", "Some Seller")}
    `;

    expect(build(body)).toEqual({
      price: 24.99,
      isCaptcha: false,
      dispatchFrom: "Amazon",
    });
  });

  it("falls back to the merchant when there is no fulfiller", () => {
    const body = offerText("merchantInfoFeature", "Some Seller");
    expect(build(body).dispatchFrom).toBe("Some Seller");
  });

  it("leaves missing fields undefined", () => {
    expect(build(`<div id="dp"></div>`)).toEqual({
      price: undefined,
      isCaptcha: false,
      dispatchFrom: undefined,
    });
  });

  it("builds the product page url with a search referer", () => {
    const country = { code: "de" } as Country;
    const ad = { id: 1, asin: "B0TESTASIN" } as AmazonAd;

    expect(builder.buildUrl(country, ad)).toEqual({
      url: "de/dp/B0TESTASIN",
      referer: "de/s?k=B0TESTASIN",
    });
  });
});
