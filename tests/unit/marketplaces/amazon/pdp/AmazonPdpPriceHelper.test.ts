import { describe, expect, it } from "vitest";
import { AmazonPdpPriceHelper } from "@/marketplaces/amazon/pdp/AmazonPdpPriceHelper";
import { buildAd, buildAmazonCountry, buildPrice } from "@@tests/support/factories";
import { fakeAmazonPdpResultSender } from "@@tests/support/fakes";

const setup = () => {
  const sender = fakeAmazonPdpResultSender();
  const helper = new AmazonPdpPriceHelper(sender.service);
  return { sender, helper };
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

  describe("hasEnoughPrices", () => {
    const { helper } = setup();
    const withValues = (values: (number | undefined)[]) =>
      values.map((value) => buildPrice({ value, complete: true }));

    it("is true once 4 countries have a price", () => {
      expect(helper.hasEnoughPrices(withValues([10, 10, undefined, 10, 10]))).toBe(true);
    });

    it("is false with fewer than 4 prices", () => {
      expect(helper.hasEnoughPrices(withValues([10, 10, 10, undefined]))).toBe(false);
    });
  });

  describe("isDeleted", () => {
    const { helper } = setup();
    const country = (active: boolean, deleted: boolean) =>
      buildPrice({ country: buildAmazonCountry({ active }), deleted });

    it("is true when every active country is deleted", () => {
      expect(helper.isDeleted([country(true, true), country(true, true)])).toBe(true);
      expect(helper.isDeleted([country(true, true)])).toBe(true);
    });

    it("is false while an active country is not deleted", () => {
      expect(helper.isDeleted([country(true, true), country(true, false)])).toBe(false);
    });

    it("ignores inactive countries", () => {
      expect(helper.isDeleted([country(true, true), country(false, false)])).toBe(true);
      expect(helper.isDeleted([country(true, false), country(false, true)])).toBe(false);
    });

    it("is false without an active country", () => {
      expect(helper.isDeleted([country(false, true)])).toBe(false);
    });
  });

  describe("sendCompletedPrices", () => {
    const ad = buildAd({ id: 7 });

    it("sends prices of countries that have a value", () => {
      const { sender, helper } = setup();
      const prices = [
        buildPrice({
          country: buildAmazonCountry({ countryId: 1 }),
          value: 19.99,
          dispatchFrom: "Amazon",
        }),
        buildPrice({ country: buildAmazonCountry({ countryId: 2 }) }),
        buildPrice({ country: buildAmazonCountry({ countryId: 3 }), value: 21.5 }),
      ];

      helper.sendCompletedPrices(prices, ad);

      expect(sender.prices).toHaveBeenCalledWith(7, [
        { adId: 7, countryId: 1, value: 19.99, dispatchFrom: "Amazon" },
        { adId: 7, countryId: 3, value: 21.5, dispatchFrom: undefined },
      ]);
    });

    // The backend counts every ad with prices as scraped in its stats
    it("sends an empty list when no country has a price", () => {
      const { sender, helper } = setup();
      helper.sendCompletedPrices([buildPrice(), buildPrice()], ad);
      expect(sender.prices).toHaveBeenCalledWith(7, []);
    });

    it("sends nothing for an ad without countries", () => {
      const { sender, helper } = setup();
      helper.sendCompletedPrices([], ad);
      expect(sender.prices).not.toHaveBeenCalled();
    });
  });
});
