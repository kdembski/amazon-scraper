import { describe, expect, it } from "vitest";
import { AmazonAdPrices } from "@/marketplaces/amazon/pdp/AmazonAdPrices";
import { AmazonCountryPrice } from "@/marketplaces/amazon/pdp/AmazonCountryPrice";
import { buildAmazonCountry, buildPrice, buildRoute } from "@@tests/support/factories";

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
      expect(withValues([10, 10, 10, 10, undefined]).isDecided).toBe(false);
    });

    it("is true once 5 countries have a price", () => {
      expect(withValues([10, 10, undefined, 10, 10, 10]).isDecided).toBe(true);
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
    const at = (countryId: number, priority: number) =>
      buildPrice({ country: buildAmazonCountry({ countryId, priority }) });

    it("lists the route priorities of all countries once, highest first", () => {
      const twoRoutes = buildPrice({
        country: buildAmazonCountry({
          countryId: 4,
          routes: [buildRoute({ id: 40, priority: 5 }), buildRoute({ id: 41, priority: 2 })],
        }),
      });

      expect(pricesOf(at(1, 0), twoRoutes, at(3, 0)).priorities()).toEqual([5, 2, 0]);
    });

    it("pendingAt holds the countries not complete whose current route has the priority", () => {
      const [low, high, alsoLow, done] = [at(1, 0), at(2, 5), at(3, 0), buildPrice({ complete: true })];
      const prices = pricesOf(low, high, alsoLow, done);

      expect(prices.pendingAt(0)).toEqual([low, alsoLow]);
      expect(prices.pendingAt(5)).toEqual([high]);
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
        missingRouteIds: [],
      });
    });

    it("is empty when no country has a price", () => {
      expect(pricesOf(at(1), at(2)).toResult(7)).toEqual({ prices: [], missingRouteIds: [] });
    });

    it("holds the routes the ad is missing in", () => {
      const prices = pricesOf(at(1, { missingRouteIds: [10, 11] }), at(2), at(3, { missingRouteIds: [30] }));

      expect(prices.toResult(7).missingRouteIds).toEqual([10, 11, 30]);
    });
  });
});
