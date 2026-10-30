import { describe, expect, it, vi } from "vitest";
import { AmazonPdpAdScraper } from "@/marketplaces/amazon/pdp/AmazonPdpAdScraper";
import type { AmazonPdpCountryScraper } from "@/marketplaces/amazon/pdp/AmazonPdpCountryScraper";
import { AmazonPdpPriceHelper } from "@/marketplaces/amazon/pdp/AmazonPdpPriceHelper";
import type { AmazonAdPrice } from "@/marketplaces/amazon/types/amazon.types";
import type { ItemOutcome } from "@/shared/metrics/metrics.types";
import type { MetricsService } from "@/shared/metrics/MetricsService";
import { buildAd, buildAmazonCountry } from "@@tests/support/factories";
import { fakeAmazonPdpResultSender } from "@@tests/support/fakes";

const setup = (count: number, priorities: number[] = [], active: boolean[] = []) => {
  const sender = fakeAmazonPdpResultSender();
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
  const increment = vi.fn();
  const gauge = vi.fn();
  const scraper = new AmazonPdpAdScraper(
    countryScraper,
    new AmazonPdpPriceHelper(sender.service),
    sender.service,
    { increment, gauge } as unknown as MetricsService
  );
  const inFlight = () => gauge.mock.calls[0][1]();
  const ad = buildAd({ id: 7 });
  const countries = Array.from({ length: count }, (_, i) =>
    buildAmazonCountry({
      countryId: i + 1,
      tld: `c${i + 1}`,
      priority: priorities[i] ?? 0,
      active: active[i] ?? true,
    })
  );
  const done = vi.fn();
  scraper.execute(ad, countries).then(done);

  const withPrice = (i: number, value = 10) => {
    runs[i].price.value = value;
    runs[i].finish("data");
  };

  return { sender, execute, runs, ad, countries, done, withPrice, increment, gauge, inFlight };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

const sent = (countryIds: number[]) =>
  countryIds.map((countryId) => ({
    adId: 7,
    countryId,
    value: 10,
    dispatchFrom: undefined,
  }));

describe("AmazonPdpAdScraper", () => {
  it("starts every country with a fresh price state", () => {
    const { execute, ad, countries } = setup(2);

    expect(execute).toHaveBeenCalledTimes(2);
    countries.forEach((country, i) =>
      expect(execute.mock.calls[i]).toEqual([
        { country, complete: false, deleted: false, failed: 0, notFound: 0 },
        ad,
        expect.any(Function),
      ])
    );
  });

  describe("metrics", () => {
    it("counts an ad with prices and its duration and keeps it in flight until then", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const { increment, gauge, inFlight, withPrice } = setup(2);
      expect(gauge).toHaveBeenCalledWith("ads_in_flight", expect.any(Function));
      expect(inFlight()).toBe(1);

      vi.setSystemTime(Date.now() + 1500);
      withPrice(0);
      withPrice(1);
      await flush();
      vi.useRealTimers();

      expect(inFlight()).toBe(0);
      expect(increment.mock.calls).toEqual([
        ["ads", { outcome: "prices" }],
        ["ad_duration_ms", {}, 1500],
      ]);
    });

    it("counts an ad without any price as empty", async () => {
      const { increment, runs } = setup(2);

      runs[0].finish("no_data");
      runs[1].finish("given_up");
      await flush();

      expect(increment).toHaveBeenCalledWith("ads", { outcome: "empty" });
    });

    it("counts a deleted ad", async () => {
      const { increment, runs } = setup(1);

      runs[0].finish("deleted");
      await flush();

      expect(increment).toHaveBeenCalledWith("ads", { outcome: "deleted" });
    });
  });

  it("waits for all countries before sending the prices", async () => {
    const { sender, done, withPrice } = setup(3);

    withPrice(0);
    withPrice(1);
    await flush();
    expect(sender.prices).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();

    withPrice(2);
    await flush();
    expect(sender.prices).toHaveBeenCalledTimes(1);
    expect(sender.prices).toHaveBeenCalledWith(7, sent([1, 2, 3]));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it.each([[1], [2]])("sends the prices of an ad with %i countries", async (count) => {
    const { sender, done, withPrice } = setup(count);

    for (let i = 0; i < count; i++) withPrice(i);
    await flush();

    expect(sender.prices).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("sends the prices once 4 countries have one and cancels the rest", async () => {
    const { sender, runs, done, withPrice } = setup(6);

    [0, 1, 2, 3].forEach((i) => withPrice(i));
    await flush();

    expect(sender.prices).toHaveBeenCalledTimes(1);
    expect(sender.prices).toHaveBeenCalledWith(7, sent([1, 2, 3, 4]));
    expect(done).toHaveBeenCalledTimes(1);
    expect(runs[4].isCancelled()).toBe(true);

    // Late results of the cancelled countries change nothing
    withPrice(4);
    runs[5].finish("deleted");
    await flush();

    expect(sender.prices).toHaveBeenCalledTimes(1);
    expect(sender.deleted).not.toHaveBeenCalled();
  });

  it("keeps scraping while fewer than 4 countries have a price", async () => {
    const { sender, runs, withPrice } = setup(5);

    runs[0].finish("no_data");
    [1, 2, 3].forEach((i) => withPrice(i));
    await flush();
    expect(sender.prices).not.toHaveBeenCalled();
    expect(runs[4].isCancelled()).toBe(false);

    withPrice(4);
    await flush();
    expect(sender.prices).toHaveBeenCalledTimes(1);
  });

  it("completes the ad without the price of a given up country", async () => {
    const { sender, runs, done, withPrice } = setup(3);

    runs[0].finish("given_up");
    withPrice(1);
    withPrice(2);
    await flush();

    expect(sender.prices).toHaveBeenCalledWith(7, sent([2, 3]));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("ignores a country that stopped because it was cancelled", async () => {
    const { sender, runs } = setup(1);

    runs[0].finish(undefined);
    await flush();

    expect(sender.prices).not.toHaveBeenCalled();
    expect(runs[0].price.complete).toBe(false);
  });

  describe("deleted countries", () => {
    it("sends prices of the remaining countries", async () => {
      const { sender, runs, done, withPrice } = setup(5);

      runs[0].finish("deleted");
      runs[1].finish("deleted");
      [2, 3, 4].forEach((i) => withPrice(i));
      await flush();

      expect(runs[0].price).toMatchObject({ deleted: true, complete: true });
      expect(sender.prices).toHaveBeenCalledWith(7, sent([3, 4, 5]));
      expect(done).toHaveBeenCalledTimes(1);
    });

    it("sends the remaining price when one active country is not deleted", async () => {
      const { sender, runs, done, withPrice } = setup(5);

      [0, 1, 2, 3].forEach((i) => runs[i].finish("deleted"));
      withPrice(4);
      await flush();

      expect(sender.deleted).not.toHaveBeenCalled();
      expect(sender.prices).toHaveBeenCalledWith(7, sent([5]));
      expect(done).toHaveBeenCalledTimes(1);
    });

    it("deletes the ad when every active country is deleted and cancels the inactive ones", async () => {
      const { sender, runs, done, withPrice } = setup(5, [], [true, true, false, false, false]);

      runs[0].finish("deleted");
      await flush();
      expect(sender.deleted).not.toHaveBeenCalled();

      runs[1].finish("deleted");
      await flush();

      expect(sender.deleted).toHaveBeenCalledTimes(1);
      expect(sender.deleted).toHaveBeenCalledWith(7);
      expect(done).toHaveBeenCalledTimes(1);
      expect(runs[2].isCancelled()).toBe(true);

      withPrice(2);
      runs[3].finish("deleted");
      await flush();

      expect(sender.prices).not.toHaveBeenCalled();
      expect(sender.deleted).toHaveBeenCalledTimes(1);
    });
  });

  describe("priorities", () => {
    const started = (runs: { price: AmazonAdPrice }[]) =>
      runs.map((run) => run.price.country.tld);

    it("starts lower priority countries only after the higher ones finish", async () => {
      const { sender, runs, done, withPrice } = setup(3, [0, 1, 1]);

      expect(started(runs)).toEqual(["c2", "c3"]);

      withPrice(0);
      await flush();
      expect(started(runs)).toEqual(["c2", "c3"]);

      runs[1].finish("no_data");
      await flush();
      expect(started(runs)).toEqual(["c2", "c3", "c1"]);
      expect(sender.prices).not.toHaveBeenCalled();

      withPrice(2);
      await flush();
      expect(sender.prices).toHaveBeenCalledWith(7, sent([1, 2]));
      expect(done).toHaveBeenCalledTimes(1);
    });

    it("never starts lower priority countries once 4 have a price", async () => {
      const { sender, runs, done, withPrice } = setup(6, [2, 2, 1, 1, 1, 0]);

      withPrice(0);
      withPrice(1);
      await flush();
      expect(started(runs)).toEqual(["c1", "c2", "c3", "c4", "c5"]);

      withPrice(2);
      withPrice(3);
      await flush();

      expect(sender.prices).toHaveBeenCalledWith(7, sent([1, 2, 3, 4]));
      expect(done).toHaveBeenCalledTimes(1);
      expect(runs[4].isCancelled()).toBe(true);

      runs[4].finish("no_data");
      await flush();
      expect(started(runs)).toHaveLength(5);
    });

    it("deletes the ad without starting lower priority inactive countries", async () => {
      const { sender, runs, done } = setup(5, [1, 1, 1, 0, 0], [true, true, true, false, false]);

      [0, 1, 2].forEach((i) => runs[i].finish("deleted"));
      await flush();

      expect(sender.deleted).toHaveBeenCalledWith(7);
      expect(done).toHaveBeenCalledTimes(1);
      expect(started(runs)).toHaveLength(3);
    });

    it("starts lower priority active countries before deleting the ad", async () => {
      const { sender, runs, done } = setup(3, [1, 1, 0]);

      [0, 1].forEach((i) => runs[i].finish("deleted"));
      await flush();
      expect(sender.deleted).not.toHaveBeenCalled();
      expect(started(runs)).toEqual(["c1", "c2", "c3"]);

      runs[2].finish("deleted");
      await flush();
      expect(sender.deleted).toHaveBeenCalledWith(7);
      expect(done).toHaveBeenCalledTimes(1);
    });
  });
});
