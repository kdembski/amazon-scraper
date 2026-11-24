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

  it.each([
    ["1.299,00 €", 1299],
    ["19,99 €", 19.99],
    ["€1,299.00", 1299],
    ["1.299 €", 1299],
    ["1,299 €", 1299],
    ["£12.5", 12.5],
    ["1 299,50 kr", 1299.5],
    ["129 zł", 129],
    ["1.234.567,89 €", 1234567.89],
    ["1,234,567.89 $", 1234567.89],
  ])("reads the accessibility label %s", (label, price) => {
    const box = `<span class="apex-pricetopay-accessibility-label">${label}</span>`;

    expect(parser.parse(priceBox(box))).toBe(price);
  });

  it("falls back to .a-offscreen without the whole and fraction parts", () => {
    const box = `<span class="a-price"><span class="a-offscreen">24,99 €</span></span>`;

    expect(parser.parse(priceBox(box))).toBe(24.99);
  });

  it("prefers the accessibility label over .a-offscreen", () => {
    const box =
      `<span class="apex-pricetopay-accessibility-label">19,99 €</span>` +
      `<span class="a-price"><span class="a-offscreen">24,99 €</span></span>`;

    expect(parser.parse(priceBox(box))).toBe(19.99);
  });

  it("reads the label when the whole part has no fraction", () => {
    const box =
      `<span class="a-price"><span class="a-price-whole">24,</span>` +
      `<span class="a-offscreen">24,99 €</span></span>`;

    expect(parser.parse(priceBox(box))).toBe(24.99);
  });

  it("gives nothing for a label without digits", () => {
    const box = `<span class="apex-pricetopay-accessibility-label">—</span>`;

    expect(parser.parse(priceBox(box))).toBeUndefined();
  });

  it("prefers the price to pay over another price", () => {
    const box = `${aPrice("99", "00")}<span class="apex-pricetopay-value">${aPrice("24", "99")}</span>`;

    expect(parser.parse(priceBox(box))).toBe(24.99);
  });

  it("gives nothing without a price", () => {
    expect(parser.parse(priceBox("<span>x</span>"))).toBeUndefined();
  });
});
