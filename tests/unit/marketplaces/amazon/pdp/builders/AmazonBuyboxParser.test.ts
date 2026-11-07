import { describe, expect, it } from "vitest";
import { AmazonBuyboxParser } from "@/marketplaces/amazon/pdp/builders/AmazonBuyboxParser";
import { find } from "@/shared/utils/html";
import { toDocument, twisterBuybox } from "@@tests/support/html";

const parser = new AmazonBuyboxParser();
const parse = (body: string) => parser.parse(find("#box", toDocument(`<div id="box">${body}</div>`)));

describe("AmazonBuyboxParser", () => {
  it("is invalid without a buy box", () => {
    expect(parser.parse(null)).toEqual({ isValid: false });
  });

  it("is invalid when the price is not available", () => {
    expect(parse(twisterBuybox({ price: "24,99", hidden: true }))).toEqual({
      isValid: false,
    });
  });

  it("is valid without a price when the buy box has none", () => {
    expect(parse(twisterBuybox())).toEqual({ isValid: true });
  });

  it("reads the price and the shipper", () => {
    expect(parse(twisterBuybox({ price: "24,99", shipsFrom: "Amazon.nl", soldBy: "Shop" }))).toEqual({
      isValid: true,
      price: 24.99,
      dispatchFrom: "Amazon",
    });
  });

  it("skips the subscription price", () => {
    expect(parse(twisterBuybox({ snsPrice: "19,99", price: "24,99" })).price).toBe(24.99);
  });

  it("has no price when only the subscription has one", () => {
    expect(parse(twisterBuybox({ snsPrice: "19,99" })).price).toBeUndefined();
  });

  it("falls back to the cart price", () => {
    expect(parse(twisterBuybox({ cartPrice: "30.07" })).price).toBe(30.07);
  });

  it("falls back to the merchant when there is no fulfiller", () => {
    expect(parse(twisterBuybox({ price: "24,99", soldBy: "Shop" })).dispatchFrom).toBe("Shop");
  });
});
