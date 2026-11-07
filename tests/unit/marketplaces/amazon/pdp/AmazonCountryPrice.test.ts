import { describe, expect, it } from "vitest";
import { AmazonCountryPrice, NOT_FOUND_TO_DELETE } from "@/marketplaces/amazon/pdp/AmazonCountryPrice";
import { buildAmazonCountry } from "@@tests/support/factories";

const priceIn = (active = true) => new AmazonCountryPrice(buildAmazonCountry({ countryId: 4, active }));

describe("AmazonCountryPrice", () => {
  it("starts without a result", () => {
    const price = priceIn();

    expect(price.hasPrice).toBe(false);
    expect(price.complete).toBe(false);
    expect(price.retry.failed).toBe(0);
  });

  it("has a price only above 0", () => {
    const price = priceIn();

    price.setResult(0);
    expect(price.hasPrice).toBe(false);

    price.setResult(10, "Amazon");
    expect(price.hasPrice).toBe(true);
  });

  it("is gone from an active country after NOT_FOUND_TO_DELETE 404s", () => {
    const price = priceIn();

    for (let i = 1; i < NOT_FOUND_TO_DELETE; i++) expect(price.registerNotFound()).toBe(false);
    expect(price.missing).toBe(false);

    expect(price.registerNotFound()).toBe(true);
    expect(price.missing).toBe(true);
  });

  it("is gone from an inactive country after one 404", () => {
    const price = priceIn(false);

    expect(price.registerNotFound()).toBe(true);
    expect(price.missing).toBe(true);
  });

  it.each([
    ["deleted", true],
    ["data", false],
    ["given_up", false],
  ] as const)("finishes with %s", (outcome, deleted) => {
    const price = priceIn();

    price.finish(outcome);

    expect(price.complete).toBe(true);
    expect(price.deleted).toBe(deleted);
  });

  it("builds the price for the backend", () => {
    const price = priceIn();
    price.setResult(19.99, "Amazon");

    expect(price.toPdpPrice(7)).toEqual({ adId: 7, countryId: 4, value: 19.99, dispatchFrom: "Amazon" });
  });
});
