import { describe, expect, it } from "vitest";
import { AmazonAdPrices } from "@/marketplaces/amazon/pdp/AmazonAdPrices";
import { AmazonCountryPrice } from "@/marketplaces/amazon/pdp/AmazonCountryPrice";
import { buildAmazonCountry, buildPrice } from "@@tests/support/factories";

const pricesOf = (...prices: AmazonCountryPrice[]) => new AmazonAdPrices(prices);

describe("AmazonAdPrices", () => {
  describe("isEmpty", () => {
    it("is true without countries", () => {
      expect(pricesOf().isEmpty).toBe(true);
      expect(pricesOf(buildPrice()).isEmpty).toBe(false);
    });
  });

  describe("isDecided", () => {
    const withValues = (values: (number | undefined)[]) =>
      pricesOf(...values.map((value) => buildPrice({ value })));

    it("is true when every country is complete", () => {
      expect(pricesOf(buildPrice({ complete: true }), buildPrice({ complete: true })).isDecided).toBe(true);
    });

    it("is false while any country is not complete and prices are too few", () => {
      expect(pricesOf(buildPrice({ complete: true }), buildPrice()).isDecided).toBe(false);
      expect(withValues([10, 10, 10, undefined]).isDecided).toBe(false);
    });

    it("is true once 4 countries have a price", () => {
      expect(withValues([10, 10, undefined, 10, 10]).isDecided).toBe(true);
    });
  });

  describe("isDeleted", () => {
    const country = (active: boolean, deleted: boolean) =>
      buildPrice({ country: buildAmazonCountry({ active }), deleted });

    it("is true when every active country is deleted", () => {
      expect(pricesOf(country(true, true), country(true, true)).isDeleted).toBe(true);
      expect(pricesOf(country(true, true)).isDeleted).toBe(true);
    });

    it("is false while an active country is not deleted", () => {
      expect(pricesOf(country(true, true), country(true, false)).isDeleted).toBe(false);
    });

    it("ignores inactive countries", () => {
      expect(pricesOf(country(true, true), country(false, false)).isDeleted).toBe(true);
      expect(pricesOf(country(true, false), country(false, true)).isDeleted).toBe(false);
    });

    it("is false without an active country", () => {
      expect(pricesOf(country(false, true)).isDeleted).toBe(false);
    });
  });

  describe("tiers", () => {
    it("groups countries by priority, highest first", () => {
      const at = (countryId: number, priority: number) =>
        buildPrice({ country: buildAmazonCountry({ countryId, priority }) });
      const [low, high, alsoLow] = [at(1, 0), at(2, 5), at(3, 0)];

      expect(pricesOf(low, high, alsoLow).tiers()).toEqual([[high], [low, alsoLow]]);
    });
  });

  describe("toResult", () => {
    const at = (countryId: number, overrides = {}) =>
      buildPrice({ country: buildAmazonCountry({ countryId }), ...overrides });

    it("holds prices of countries that have a value", () => {
      const prices = pricesOf(at(1, { value: 19.99, dispatchFrom: "Amazon" }), at(2), at(3, { value: 21.5 }));

      expect(prices.toResult(7)).toEqual({
        prices: [
          { adId: 7, countryId: 1, value: 19.99, dispatchFrom: "Amazon" },
          { adId: 7, countryId: 3, value: 21.5, dispatchFrom: undefined },
        ],
        missingCountryIds: [],
      });
    });

    it("is empty when no country has a price", () => {
      expect(pricesOf(at(1), at(2)).toResult(7)).toEqual({ prices: [], missingCountryIds: [] });
    });

    it("holds the countries the ad is missing in", () => {
      const prices = pricesOf(at(1, { missing: true }), at(2), at(3, { missing: true }));

      expect(prices.toResult(7).missingCountryIds).toEqual([1, 3]);
    });
  });
});
