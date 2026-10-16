import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestAmazonPdpCountryScraper } from "@/scrapers/RequestAmazonPdpCountryScraper";
import { AmazonPdpPriceHelper } from "@/scrapers/AmazonPdpPriceHelper";
import { MAX_FAILED_ATTEMPTS } from "@/helpers/retry";
import { AmazonAdBuildResult, AmazonAdPrice } from "@/types/amazon.types";
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
  const scraper = new RequestAmazonPdpCountryScraper(
    amazon.service,
    api.service,
    builder.builder,
    new AmazonPdpPriceHelper(api.service)
  );
  const ad = buildAd({ id: 7 });
  const resolveAd = vi.fn();

  const run = (prices: AmazonAdPrice[]) =>
    prices.forEach((price) => scraper.execute(price, ad, prices, resolveAd));

  return { amazon, api, builder, scraper, ad, resolveAd, run };
};

// Settles the promise chains started by the callbacks
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("RequestAmazonPdpCountryScraper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("requests the url built for the country", () => {
    const { amazon, builder, ad, run } = setup();
    const prices = buildPrices(1);
    run(prices);

    expect(builder.buildUrl).toHaveBeenCalledWith(prices[0].country, ad);
    expect(amazon.get).toHaveBeenCalledWith("c1/dp/B0TESTASIN", "c1/ref", {
      onSuccess: expect.any(Function),
      onError: expect.any(Function),
    });
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
      const { amazon, run } = setup({ price: 24.99, dispatchFrom: "Amazon" });
      const prices = buildPrices(3);
      run(prices);

      amazon.respond(0, html);
      await flush();

      expect(prices[0]).toMatchObject({
        value: 24.99,
        dispatchFrom: "Amazon",
        pending: false,
        complete: true,
      });
      expect(amazon.queueService.completed).toBe(1);
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
      expect(amazon.queueService.failed).toBe(1);
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
});
