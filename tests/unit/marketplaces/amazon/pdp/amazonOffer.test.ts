import { describe, expect, it } from "vitest";
import {
  getOfferPrice,
  normalizeDispatchFrom,
} from "@/marketplaces/amazon/pdp/amazonOffer";
import { find } from "@/shared/utils/html";
import { aPrice, toDocument } from "@@tests/support/html";

const priceBox = (body: string) => find("#box", toDocument(`<div id="box">${body}</div>`))!;

describe("getOfferPrice", () => {
  it("reads the whole and fraction parts", () => {
    expect(getOfferPrice(priceBox(aPrice("24", "99")))).toBe(24.99);
  });

  it("falls back to the accessibility label", () => {
    const label = `<span class="apex-pricetopay-accessibility-label">1.299,00 €</span>`;

    expect(getOfferPrice(priceBox(label))).toBe(1299);
  });

  it("gives nothing without a price", () => {
    expect(getOfferPrice(priceBox("<span>x</span>"))).toBeUndefined();
  });
});

describe("normalizeDispatchFrom", () => {
  it("collapses whitespace", () => {
    expect(normalizeDispatchFrom("  Some \n  Seller ")).toBe("Some Seller");
  });

  it("names Amazon by its domain plain Amazon", () => {
    expect(normalizeDispatchFrom("Amazon.nl")).toBe("Amazon");
    expect(normalizeDispatchFrom("amazon.com.be")).toBe("Amazon");
  });

  it("keeps other sellers", () => {
    expect(normalizeDispatchFrom("Some Seller")).toBe("Some Seller");
  });

  it("gives nothing for an empty value", () => {
    expect(normalizeDispatchFrom("  ")).toBeUndefined();
    expect(normalizeDispatchFrom(undefined)).toBeUndefined();
  });
});
