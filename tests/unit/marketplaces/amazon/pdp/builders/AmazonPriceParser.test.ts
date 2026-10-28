import { describe, expect, it } from "vitest";
import { AmazonPriceParser } from "@/marketplaces/amazon/pdp/builders/AmazonPriceParser";
import { find } from "@/shared/utils/html";
import { aPrice, toDocument } from "@@tests/support/html";

const parser = new AmazonPriceParser();
const priceBox = (body: string) => find("#box", toDocument(`<div id="box">${body}</div>`))!;

describe("AmazonPriceParser", () => {
  it("reads the whole and fraction parts", () => {
    expect(parser.parse(priceBox(aPrice("24", "99")))).toBe(24.99);
  });

  it("falls back to the accessibility label", () => {
    const label = `<span class="apex-pricetopay-accessibility-label">1.299,00 €</span>`;

    expect(parser.parse(priceBox(label))).toBe(1299);
  });

  it("gives nothing without a price", () => {
    expect(parser.parse(priceBox("<span>x</span>"))).toBeUndefined();
  });
});
