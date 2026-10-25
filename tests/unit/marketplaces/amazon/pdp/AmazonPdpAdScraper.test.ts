import { describe, expect, it, vi } from "vitest";
import { AmazonPdpAdScraper } from "@/marketplaces/amazon/pdp/AmazonPdpAdScraper";
import type { AmazonPdpCountryScraper } from "@/marketplaces/amazon/pdp/AmazonPdpCountryScraper";
import { AmazonPdpPriceHelper } from "@/marketplaces/amazon/pdp/AmazonPdpPriceHelper";
import type { AmazonAdPrice } from "@/marketplaces/amazon/types/amazon.types";
import type { ItemOutcome } from "@/shared/metrics/metrics.types";
import { buildAd, buildAmazonCountry } from "@@tests/support/factories";
import { fakeApiService } from "@@tests/support/fakes";

const setup = (count: number) => {
  const api = fakeApiService();
  const runs: {
    price: AmazonAdPrice;
    isCancelled: () => boolean;
    finish: (outcome?: ItemOutcome) => void;
  }[] = [];
  const execute = vi.fn(
    (price: AmazonAdPrice, _ad, isCancelled: () => boolean) =>
      new Promise<ItemOutcome | undefined>((finish) => runs.push({ price, isCancelled, finish }))
  );
  const countryScraper = { execute } as unknown as AmazonPdpCountryScraper;
  const scraper = new AmazonPdpAdScraper(
    countryScraper,
    new AmazonPdpPriceHelper(api.service),
    api.service
  );
  const ad = buildAd({ id: 7 });
  const countries = Array.from({ length: count }, (_, i) =>
    buildAmazonCountry({ countryId: i + 1, tld: `c${i + 1}` })
  );
  const done = vi.fn();
  scraper.execute(ad, countries).then(done);

  const withPrice = (i: number, value = 10) => {
    runs[i].price.value = value;
    runs[i].finish("data");
  };

  return { api, execute, runs, ad, countries, done, withPrice };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

const sent = (countryIds: number[]) => ({
  prices: countryIds.map((countryId) => ({
    adId: 7,
    countryId,
    value: 10,
    dispatchFrom: undefined,
  })),
});

describe("AmazonPdpAdScraper", () => {
  it("starts every country with a fresh price state", () => {
    const { execute, ad, countries } = setup(2);

    expect(execute).toHaveBeenCalledTimes(2);
    countries.forEach((country, i) =>
      expect(execute.mock.calls[i]).toEqual([
        { country, complete: false, deleted: false, failed: 0 },
        ad,
        expect.any(Function),
      ])
    );
  });

  it("waits for all countries before sending the prices", async () => {
    const { api, done, withPrice } = setup(3);

    withPrice(0);
    withPrice(1);
    await flush();
    expect(api.put).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();

    withPrice(2);
    await flush();
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith("amazon/ads/7", sent([1, 2, 3]));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it.each([[1], [2]])("sends the prices of an ad with %i countries", async (count) => {
    const { api, done, withPrice } = setup(count);

    for (let i = 0; i < count; i++) withPrice(i);
    await flush();

    expect(api.put).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("sends the prices once 4 countries have one and cancels the rest", async () => {
    const { api, runs, done, withPrice } = setup(6);

    [0, 1, 2, 3].forEach((i) => withPrice(i));
    await flush();

    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith("amazon/ads/7", sent([1, 2, 3, 4]));
    expect(done).toHaveBeenCalledTimes(1);
    expect(runs[4].isCancelled()).toBe(true);

    // Late results of the cancelled countries change nothing
    withPrice(4);
    runs[5].finish("deleted");
    await flush();

    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("keeps scraping while fewer than 4 countries have a price", async () => {
    const { api, runs, withPrice } = setup(5);

    runs[0].finish("no_data");
    [1, 2, 3].forEach((i) => withPrice(i));
    await flush();
    expect(api.put).not.toHaveBeenCalled();
    expect(runs[4].isCancelled()).toBe(false);

    withPrice(4);
    await flush();
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it("completes the ad without the price of a given up country", async () => {
    const { api, runs, done, withPrice } = setup(3);

    runs[0].finish("given_up");
    withPrice(1);
    withPrice(2);
    await flush();

    expect(api.put).toHaveBeenCalledWith("amazon/ads/7", sent([2, 3]));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("ignores a country that stopped because it was cancelled", async () => {
    const { api, runs } = setup(1);

    runs[0].finish(undefined);
    await flush();

    expect(api.put).not.toHaveBeenCalled();
    expect(runs[0].price.complete).toBe(false);
  });

  describe("deleted countries", () => {
    it("sends prices of the remaining countries", async () => {
      const { api, runs, done, withPrice } = setup(5);

      runs[0].finish("deleted");
      runs[1].finish("deleted");
      [2, 3, 4].forEach((i) => withPrice(i));
      await flush();

      expect(runs[0].price).toMatchObject({ deleted: true, complete: true });
      expect(api.put).toHaveBeenCalledWith("amazon/ads/7", sent([3, 4, 5]));
      expect(done).toHaveBeenCalledTimes(1);
    });

    it("deletes the ad when at most 2 countries are left and cancels the rest", async () => {
      const { api, runs, done, withPrice } = setup(5);

      [0, 1, 2].forEach((i) => runs[i].finish("deleted"));
      await flush();

      expect(api.delete).toHaveBeenCalledTimes(1);
      expect(api.delete).toHaveBeenCalledWith("amazon/ads/7");
      expect(done).toHaveBeenCalledTimes(1);
      expect(runs[3].isCancelled()).toBe(true);

      withPrice(3);
      runs[4].finish("deleted");
      await flush();

      expect(api.put).not.toHaveBeenCalled();
      expect(api.delete).toHaveBeenCalledTimes(1);
    });
  });
});
