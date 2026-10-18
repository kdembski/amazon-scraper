import { describe, expect, it } from "vitest";
import { AmazonPdpPriceHelper } from "@/marketplaces/amazon/pdp/AmazonPdpPriceHelper";
import { buildAd, buildCountry, buildPrice } from "@@tests/support/factories";
import { fakeApiService } from "@@tests/support/fakes";

const setup = () => {
  const api = fakeApiService();
  const helper = new AmazonPdpPriceHelper(api.service);
  return { api, helper };
};

describe("AmazonPdpPriceHelper", () => {
  describe("isComplete", () => {
    const { helper } = setup();

    it("is true when every country is complete", () => {
      const prices = [
        buildPrice({ complete: true }),
        buildPrice({ complete: true }),
      ];
      expect(helper.isComplete(prices)).toBe(true);
    });

    it("is false while any country is not complete", () => {
      const prices = [buildPrice({ complete: true }), buildPrice()];
      expect(helper.isComplete(prices)).toBe(false);
    });
  });

  describe("isDeleted", () => {
    const { helper } = setup();
    const withDeleted = (total: number, deleted: number) =>
      Array.from({ length: total }, (_, i) =>
        buildPrice({ deleted: i < deleted })
      );

    it("is false while more than 2 countries are not deleted", () => {
      expect(helper.isDeleted(withDeleted(5, 2))).toBe(false);
    });

    it("is true when at most 2 countries are not deleted", () => {
      expect(helper.isDeleted(withDeleted(5, 3))).toBe(true);
      expect(helper.isDeleted(withDeleted(5, 5))).toBe(true);
    });

    it("is false while no country is deleted, even with 2 countries", () => {
      expect(helper.isDeleted(withDeleted(2, 0))).toBe(false);
      expect(helper.isDeleted(withDeleted(1, 0))).toBe(false);
    });

    it("is true for an ad with 2 countries when one is deleted", () => {
      expect(helper.isDeleted(withDeleted(2, 1))).toBe(true);
    });
  });

  describe("sendCompletedPrices", () => {
    const ad = buildAd({ id: 7 });

    it("sends prices of countries that have a value", () => {
      const { api, helper } = setup();
      const prices = [
        buildPrice({
          country: buildCountry({ id: 1 }),
          value: 19.99,
          dispatchFrom: "Amazon",
        }),
        buildPrice({ country: buildCountry({ id: 2 }) }),
        buildPrice({ country: buildCountry({ id: 3 }), value: 21.5 }),
      ];

      helper.sendCompletedPrices(prices, ad);

      expect(api.put).toHaveBeenCalledWith("amazon/ads/7", {
        prices: [
          { adId: 7, countryId: 1, value: 19.99, dispatchFrom: "Amazon" },
          { adId: 7, countryId: 3, value: 21.5, dispatchFrom: undefined },
        ],
      });
    });

    // The backend logs every PUT as a scraped ad in its stats
    it("sends an empty list when no country has a price", () => {
      const { api, helper } = setup();
      helper.sendCompletedPrices([buildPrice(), buildPrice()], ad);
      expect(api.put).toHaveBeenCalledWith("amazon/ads/7", { prices: [] });
    });

    it("sends nothing for an ad without countries", () => {
      const { api, helper } = setup();
      helper.sendCompletedPrices([], ad);
      expect(api.put).not.toHaveBeenCalled();
    });
  });
});
