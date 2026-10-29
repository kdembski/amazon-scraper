import { describe, expect, it } from "vitest";
import { AmazonTwisterAdBuilder } from "@/marketplaces/amazon/pdp/builders/AmazonTwisterAdBuilder";
import { buildAd, buildAmazonCountry } from "@@tests/support/factories";
import {
  botWallPage,
  captchaPage,
  toDocument,
  twisterBuybox,
  twisterResponse,
} from "@@tests/support/html";

const builder = new AmazonTwisterAdBuilder();
const build = (response: string) =>
  builder.build(toDocument(builder.trimHtml(response)));

describe("AmazonTwisterAdBuilder", () => {
  it("builds the twister URL with the product page as referer", () => {
    const country = buildAmazonCountry({ tld: "de" });
    const ad = buildAd({ asin: "B0TESTASIN" });

    expect(builder.buildUrl(country, ad)).toEqual({
      url: "de/gp/twister/ajaxv2?asinList=B0TESTASIN&id=B0TESTASIN&parentAsin=B0TESTASIN&mType=full&json=1&isUDPFlag=1&dpxAjaxFlag=1&isFlushing=2&psc=1",
      referer: "de/dp/B0TESTASIN",
    });
  });

  it("downloads the whole response while cutting is disabled", () => {
    expect(builder.stopAt).toBeUndefined();
  });

  it("treats a 404 as no data, not as a deleted product", () => {
    expect(builder.notFoundIsNoData).toBe(true);
  });

  describe("trimHtml", () => {
    it("keeps only the buy box", () => {
      const html = builder.trimHtml(twisterResponse(twisterBuybox({ price: "24,99" })));

      expect(html.startsWith('<div id="desktop_buybox">')).toBe(true);
      expect(html).toContain("apex-pricetopay-value");
      expect(html).not.toContain("olp");
    });

    it("reads a response cut right after the buy box", () => {
      const response = twisterResponse(twisterBuybox({ price: "24,99" }), { closed: false });

      expect(builder.trimHtml(response)).toContain("apex-pricetopay-value");
    });

    it("keeps a page without the buy box part", () => {
      expect(builder.trimHtml(captchaPage)).toBe(captchaPage);
    });
  });

  describe("build", () => {
    it("reads the price and the shipper", () => {
      const response = twisterResponse(
        twisterBuybox({ price: "24,99", shipsFrom: "Amazon", soldBy: "Allmax" })
      );

      expect(build(response)).toEqual({
        isCaptcha: false,
        isValid: true,
        price: 24.99,
        dispatchFrom: "Amazon",
      });
    });

    it("ignores the Subscribe & Save price", () => {
      const both = twisterResponse(twisterBuybox({ snsPrice: "22,49", price: "24,99" }));
      const snsOnly = twisterResponse(twisterBuybox({ snsPrice: "22,49" }));

      expect(build(both).price).toBe(24.99);
      expect(build(snsOnly)).toEqual({ isCaptcha: false, isValid: true });
    });

    it("falls back to the add-to-cart price of a single-offer buy box", () => {
      const response = twisterResponse(twisterBuybox({ cartPrice: "30.07", soldBy: "HLSHMHY" }));

      expect(build(response)).toEqual({
        isCaptcha: false,
        isValid: true,
        price: 30.07,
        dispatchFrom: "HLSHMHY",
      });
    });

    it("takes the seller when no shipper is shown", () => {
      expect(build(twisterResponse(twisterBuybox({ price: "1,00", soldBy: "Amazon.de" }))).dispatchFrom).toBe("Amazon");
      expect(build(twisterResponse(twisterBuybox({ price: "1,00", soldBy: "Some Seller" }))).dispatchFrom).toBe("Some Seller");
    });

    it("gives a valid result without a price when there is no offer", () => {
      expect(build(twisterResponse(twisterBuybox({ soldBy: "" })))).toEqual({
        isCaptcha: false,
        isValid: true,
      });
    });

    it("rejects a buy box that hides the price", () => {
      expect(build(twisterResponse(twisterBuybox({ price: "24,99", hidden: true })))).toEqual({
        isCaptcha: false,
        isValid: false,
      });
    });

    it("detects a captcha", () => {
      expect(build(captchaPage)).toEqual({ isCaptcha: true });
      expect(build(botWallPage)).toEqual({ isCaptcha: true });
    });

    it("rejects a response without the buy box part", () => {
      expect(build("<div>error</div>")).toEqual({ isCaptcha: false, isValid: false });
    });
  });
});
