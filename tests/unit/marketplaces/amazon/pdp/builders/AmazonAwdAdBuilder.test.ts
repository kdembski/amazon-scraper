import { describe, expect, it } from "vitest";
import { AmazonAwdAdBuilder } from "@/marketplaces/amazon/pdp/builders/AmazonAwdAdBuilder";
import type { AmazonAdBuilder } from "@/marketplaces/amazon/types/amazon.types";
import { buildAd, buildAmazonCountry } from "@@tests/support/factories";
import {
  awdPage,
  captchaPage,
  toDocument,
  twisterBuybox,
} from "@@tests/support/html";

const builder = new AmazonAwdAdBuilder();
const build = (page: string) => builder.build(toDocument(builder.trimHtml(page)));

describe("AmazonAwdAdBuilder", () => {
  it("builds the product page URL of the selected variation", () => {
    const country = buildAmazonCountry({ tld: "fr" });
    const ad = buildAd({ asin: "B0TESTASIN" });

    expect(builder.buildUrl(country, ad)).toEqual({
      url: "fr/gp/aw/d/B0TESTASIN?th=1&psc=1",
      referer: "fr/",
    });
  });

  it("stops downloading after the buy box and deletes the country on a 404", () => {
    const source: AmazonAdBuilder = builder;

    expect(source.stopAt).toEqual(['id="buybox"', 'id="olpLinkWidget_feature_div"']);
    expect(source.notFoundIsNoData).toBeFalsy();
  });

  describe("trimHtml", () => {
    it("cuts what comes before the buy box", () => {
      const html = builder.trimHtml(awdPage(twisterBuybox({ price: "24,99" })));

      expect(html.startsWith('<div id="buybox">')).toBe(true);
      expect(html).not.toContain("related");
    });

    it("keeps a page without the buy box", () => {
      expect(builder.trimHtml(captchaPage)).toBe(captchaPage);
    });
  });

  describe("build", () => {
    it("reads the buy box price and shipper, not the prices before it", () => {
      const page = awdPage(twisterBuybox({ price: "24,99", soldBy: "Amazon.fr" }));

      expect(build(page)).toEqual({
        isValid: true,
        price: 24.99,
        dispatchFrom: "Amazon",
      });
    });

    it("reads a page cut right after the buy box", () => {
      const page = `<div id="related"></div><div id="buybox">${twisterBuybox({ price: "24,99", soldBy: "Amazon.fr" })}<div id="olpLinkWidget_feature_div"`;

      expect(build(page)).toEqual({
        isValid: true,
        price: 24.99,
        dispatchFrom: "Amazon",
      });
    });

    it("gives a valid result without a price when the product is unavailable", () => {
      expect(build(awdPage(twisterBuybox({ soldBy: "" })))).toEqual({
        isValid: true,
      });
    });

    it("rejects a buy box that hides the price", () => {
      expect(build(awdPage(twisterBuybox({ price: "24,99", hidden: true })))).toEqual({
        isValid: false,
      });
    });

    it("rejects a page without the buy box", () => {
      expect(build("<div>error</div>")).toEqual({ isValid: false });
    });
  });
});
