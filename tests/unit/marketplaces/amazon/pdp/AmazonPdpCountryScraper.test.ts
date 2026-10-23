import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmazonPdpCountryScraper } from "@/marketplaces/amazon/pdp/AmazonPdpCountryScraper";
import { AmazonPdpPriceHelper } from "@/marketplaces/amazon/pdp/AmazonPdpPriceHelper";
import { MAX_FAILED_ATTEMPTS } from "@/shared/utils/retry";
import { AmazonAdBuildResult, AmazonAdPrice } from "@/marketplaces/amazon/types/amazon.types";
import type { MetricsService } from "@/shared/metrics/MetricsService";
import { buildAd, buildPrices } from "@@tests/support/factories";
import {
  fakeAdBuilder,
  fakeAmazonService,
  fakeApiService,
} from "@@tests/support/fakes";

const html = "<html><body></body></html>";
const notFound = { status: 404 };

const setup = (result: AmazonAdBuildResult = { price: 10 }) => {
  const amazon = fakeAmazonService();
  const api = fakeApiService();
  const builder = fakeAdBuilder(result);
  const increment = vi.fn();
  const metrics = { increment } as unknown as MetricsService;
  const scraper = new AmazonPdpCountryScraper(
    amazon.service,
    api.service,
    builder.builder,
    new AmazonPdpPriceHelper(api.service),
    metrics
  );
  const ad = buildAd({ id: 7 });
  const resolveAd = vi.fn();

  const run = (prices: AmazonAdPrice[]) =>
    prices.forEach((price) => scraper.execute(price, ad, prices, resolveAd));

  return { amazon, api, builder, scraper, ad, resolveAd, run, increment };
};

// Settles the promise chains started by the callbacks
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("AmazonPdpCountryScraper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("requests the url built for the country through its proxy type", () => {
    const { amazon, builder, ad, run } = setup();
    const prices = buildPrices(1);
    prices[0].country.proxyType = "isp";
    run(prices);

    expect(builder.buildUrl).toHaveBeenCalledWith(prices[0].country, ad);
    expect(amazon.get).toHaveBeenCalledWith(
      "c1/dp/B0TESTASIN",
      "c1/ref",
      { onSuccess: expect.any(Function), onError: expect.any(Function) },
      "isp"
    );
    expect(prices[0].pending).toBe(true);
  });

  it.each([["complete"], ["deleted"], ["pending"], ["adDeleted"]] as const)(
    "skips a country that is already %s",
    (state) => {
      const { amazon, run } = setup();
      const prices = buildPrices(1);
      prices[0][state] = true;
      run(prices);

      expect(amazon.get).not.toHaveBeenCalled();
    }
  );

  describe("on success", () => {
    it("stores the price and dispatchFrom of the country", async () => {
      const { amazon, builder, run } = setup({ price: 24.99, dispatchFrom: "Amazon" });
      const prices = buildPrices(3);
      run(prices);

      amazon.respond(0, html);
      await flush();

      expect(builder.trimHtml).toHaveBeenCalledWith(html);
      expect(prices[0]).toMatchObject({
        value: 24.99,
        dispatchFrom: "Amazon",
        pending: false,
        complete: true,
      });
    });

    it("waits for all countries before sending the prices", async () => {
      const { amazon, api, resolveAd, run } = setup({ price: 10 });
      const prices = buildPrices(3);
      run(prices);

      amazon.respond(0, html);
      amazon.respond(1, html);
      await flush();
      expect(api.put).not.toHaveBeenCalled();
      expect(resolveAd).not.toHaveBeenCalled();

      amazon.respond(2, html);
      await flush();
      expect(api.put).toHaveBeenCalledTimes(1);
      expect(api.put).toHaveBeenCalledWith("amazon/ads/7", {
        prices: [1, 2, 3].map((countryId) => ({
          adId: 7,
          countryId,
          value: 10,
          dispatchFrom: undefined,
        })),
      });
      expect(resolveAd).toHaveBeenCalledTimes(1);
    });

    it.each([[1], [2]])(
      "sends the prices of an ad with %i countries",
      async (count) => {
        const { amazon, api, resolveAd, run } = setup({ price: 10 });
        const prices = buildPrices(count);
        run(prices);

        prices.forEach((_, i) => amazon.respond(i, html));
        await flush();

        expect(api.put).toHaveBeenCalledTimes(1);
        expect(resolveAd).toHaveBeenCalledTimes(1);
      }
    );

    it("completes a country without an offer with no price", async () => {
      const { amazon, run } = setup({ isCaptcha: false, isValid: true });
      const prices = buildPrices(3);
      run(prices);

      amazon.respond(0, html);
      await flush();

      expect(prices[0].complete).toBe(true);
      expect(prices[0].value).toBeUndefined();
    });
  });

  describe("retries", () => {
    it.each([
      ["an empty response", { price: 10 }, ""],
      ["a captcha", { isCaptcha: true }, html],
      ["an invalid response", { isCaptcha: false, isValid: false }, html],
    ])("on %s", async (_name, result, data) => {
      const { amazon, run } = setup(result);
      const prices = buildPrices(3);
      run(prices);

      amazon.respond(0, data);
      await flush();

      expect(prices[0]).toMatchObject({
        pending: false,
        complete: false,
        failed: 1,
      });
      expect(amazon.get).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(1000);
      expect(amazon.get).toHaveBeenCalledTimes(4);
      expect(amazon.requests[3].url).toBe("c1/dp/B0TESTASIN");
    });

    it("on a network error", async () => {
      const { amazon, run } = setup();
      const prices = buildPrices(3);
      run(prices);

      amazon.fail(0);
      await flush();

      expect(prices[0].failed).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(amazon.get).toHaveBeenCalledTimes(4);
    });

    it("gives up on a country after the attempt limit", async () => {
      const { amazon, api, resolveAd, run } = setup({ price: 10 });
      const prices = buildPrices(3);
      run(prices);
      amazon.respond(1, html);
      amazon.respond(2, html);

      amazon.fail(0);
      for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
        await vi.runAllTimersAsync();
        amazon.fail(amazon.requests.length - 1);
      }
      await vi.runAllTimersAsync();

      expect(prices[0]).toMatchObject({
        complete: true,
        failed: MAX_FAILED_ATTEMPTS,
      });
      expect(prices[0].value).toBeUndefined();
      expect(amazon.get).toHaveBeenCalledTimes(3 + MAX_FAILED_ATTEMPTS - 1);
      expect(api.put).toHaveBeenCalledWith("amazon/ads/7", {
        prices: [
          { adId: 7, countryId: 2, value: 10, dispatchFrom: undefined },
          { adId: 7, countryId: 3, value: 10, dispatchFrom: undefined },
        ],
      });
      expect(resolveAd).toHaveBeenCalledTimes(1);
    });
  });

  describe("on 404", () => {
    it("marks the country as deleted without retrying", async () => {
      const { amazon, api, run } = setup();
      const prices = buildPrices(5);
      run(prices);

      amazon.fail(0, notFound);
      await vi.runAllTimersAsync();

      expect(prices[0]).toMatchObject({ deleted: true, complete: true });
      expect(prices[0].failed).toBe(0);
      expect(amazon.get).toHaveBeenCalledTimes(5);
      expect(api.delete).not.toHaveBeenCalled();
    });

    it("sends prices of the remaining countries", async () => {
      const { amazon, api, resolveAd, run } = setup({ price: 10 });
      const prices = buildPrices(5);
      run(prices);

      amazon.fail(0, notFound);
      amazon.fail(1, notFound);
      [2, 3, 4].forEach((i) => amazon.respond(i, html));
      await flush();

      expect(api.put).toHaveBeenCalledWith("amazon/ads/7", {
        prices: [3, 4, 5].map((countryId) => ({
          adId: 7,
          countryId,
          value: 10,
          dispatchFrom: undefined,
        })),
      });
      expect(resolveAd).toHaveBeenCalledTimes(1);
    });

    it("deletes the ad when at most 2 countries are left", async () => {
      const { amazon, api, resolveAd, run } = setup({ price: 10 });
      const prices = buildPrices(5);
      run(prices);

      [0, 1, 2].forEach((i) => amazon.fail(i, notFound));
      await flush();

      expect(api.delete).toHaveBeenCalledTimes(1);
      expect(api.delete).toHaveBeenCalledWith("amazon/ads/7");
      expect(resolveAd).toHaveBeenCalledTimes(1);
      prices.forEach((price) =>
        expect(price).toMatchObject({ deleted: true, adDeleted: true })
      );

      // Late responses of the other countries change nothing
      amazon.respond(3, html);
      amazon.fail(4, notFound);
      await vi.runAllTimersAsync();

      expect(api.put).not.toHaveBeenCalled();
      expect(api.delete).toHaveBeenCalledTimes(1);
      expect(resolveAd).toHaveBeenCalledTimes(1);
      expect(amazon.get).toHaveBeenCalledTimes(5);
    });
  });

  describe("retry backoff", () => {
    it("retries after an exponential backoff delay", async () => {
      const { amazon, run } = setup();
      const prices = buildPrices(1);
      prices[0].failed = 2;
      run(prices);

      amazon.fail(0);
      await flush();
      await vi.advanceTimersByTimeAsync(3999);
      expect(amazon.get).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(amazon.get).toHaveBeenCalledTimes(2);
    });

    it("waits for other countries before completing the ad", async () => {
      const { amazon, api, resolveAd, run } = setup();
      const prices = buildPrices(2);
      prices[0].failed = MAX_FAILED_ATTEMPTS - 1;
      run(prices);

      amazon.fail(0);
      await vi.runAllTimersAsync();

      expect(prices[0].complete).toBe(true);
      expect(api.put).not.toHaveBeenCalled();
      expect(resolveAd).not.toHaveBeenCalled();
    });
  });

  describe("metrics", () => {
    const calls = (increment: ReturnType<typeof vi.fn>, metric: string) =>
      increment.mock.calls.filter((call) => call[0] === metric);

    it("counts a response with a price as data", async () => {
      const { amazon, run, increment } = setup({ price: 10 });
      const prices = buildPrices(3);
      run(prices);
      const labels = { country: prices[0].country.tld, outcome: "data" };

      amazon.respond(0, html);
      await flush();

      expect(increment).toHaveBeenCalledWith("responses", labels);
      expect(increment).toHaveBeenCalledWith("items", labels);
      expect(increment).toHaveBeenCalledWith("item_attempts", labels, 1);
    });

    it("counts a response without a price as no_data", async () => {
      const { amazon, run, increment } = setup({ isCaptcha: false, isValid: true });
      const prices = buildPrices(3);
      run(prices);
      const labels = { country: prices[0].country.tld, outcome: "no_data" };

      amazon.respond(0, html);
      await flush();

      expect(increment).toHaveBeenCalledWith("responses", labels);
      expect(increment).toHaveBeenCalledWith("items", labels);
      expect(increment).toHaveBeenCalledWith("item_attempts", labels, 1);
    });

    it.each([
      ["captcha", { isCaptcha: true }, html],
      ["invalid", { isCaptcha: false, isValid: false }, html],
      ["empty", { price: 10 }, ""],
    ])("counts a %s response without an item", async (outcome, result, data) => {
      const { amazon, run, increment } = setup(result);
      const prices = buildPrices(3);
      run(prices);

      amazon.respond(0, data);
      await flush();

      expect(increment).toHaveBeenCalledWith("responses", {
        country: prices[0].country.tld,
        outcome,
      });
      expect(calls(increment, "items")).toHaveLength(0);
      expect(calls(increment, "item_attempts")).toHaveLength(0);
    });

    it("counts the attempts of a country that succeeded after failures", async () => {
      const { amazon, run, increment } = setup({ price: 10 });
      const prices = buildPrices(3);
      run(prices);

      amazon.fail(0);
      await flush();
      await vi.advanceTimersByTimeAsync(1000);
      amazon.fail(amazon.requests.length - 1);
      await flush();
      await vi.advanceTimersByTimeAsync(2000);
      amazon.respond(amazon.requests.length - 1, html);
      await flush();

      expect(increment).toHaveBeenCalledWith(
        "item_attempts",
        { country: prices[0].country.tld, outcome: "data" },
        3
      );
    });

    it("counts a deleted item only for the country that got the 404", async () => {
      const { amazon, run, increment } = setup({ price: 10 });
      const prices = buildPrices(5);
      run(prices);

      [0, 1, 2].forEach((i) => amazon.fail(i, notFound));
      await vi.runAllTimersAsync();

      const items = calls(increment, "items");
      expect(items.map((call) => call[1])).toEqual(
        [0, 1, 2].map((i) => ({
          country: prices[i].country.tld,
          outcome: "deleted",
        }))
      );
      expect(calls(increment, "item_attempts")).toHaveLength(3);
    });

    it("counts a given up country with the failed attempts", async () => {
      const { amazon, run, increment } = setup({ price: 10 });
      const prices = buildPrices(3);
      run(prices);

      amazon.fail(0);
      for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
        await vi.runAllTimersAsync();
        amazon.fail(amazon.requests.length - 1);
      }
      await vi.runAllTimersAsync();

      const labels = { country: prices[0].country.tld, outcome: "given_up" };
      expect(increment).toHaveBeenCalledWith("items", labels);
      expect(increment).toHaveBeenCalledWith(
        "item_attempts",
        labels,
        MAX_FAILED_ATTEMPTS
      );
    });
  });

  it("reads prices from the AOD fragment by default", () => {
    const amazon = fakeAmazonService();
    const scraper = new AmazonPdpCountryScraper(
      amazon.service,
      fakeApiService().service
    );
    const prices = buildPrices(1);

    scraper.execute(prices[0], buildAd(), prices, vi.fn());

    expect(amazon.requests[0].url).toBe(
      "c1/gp/product/ajax/aodAjaxMain/?asin=B0TESTASIN&pc=dp"
    );
  });
});
