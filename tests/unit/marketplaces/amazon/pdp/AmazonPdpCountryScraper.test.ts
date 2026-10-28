import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmazonPdpCountryScraper } from "@/marketplaces/amazon/pdp/AmazonPdpCountryScraper";
import { MAX_FAILED_ATTEMPTS } from "@/shared/utils/retry";
import { AmazonAdBuildResult } from "@/marketplaces/amazon/types/amazon.types";
import type { MetricsService } from "@/shared/metrics/MetricsService";
import { buildAd, buildAmazonCountry, buildPrice } from "@@tests/support/factories";
import { fakeAdBuilder, fakeAmazonService } from "@@tests/support/fakes";

const html = "<html><body></body></html>";
const notFound = { status: 404 };

const setup = (result: AmazonAdBuildResult = { price: 10 }) => {
  const amazon = fakeAmazonService();
  const builder = fakeAdBuilder(result);
  const increment = vi.fn();
  const metrics = { increment } as unknown as MetricsService;
  const scraper = new AmazonPdpCountryScraper(amazon.service, { aod: builder.builder }, metrics);
  const ad = buildAd({ id: 7 });
  const price = buildPrice({ country: buildAmazonCountry({ countryId: 1, tld: "c1" }) });
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };
  const outcome = vi.fn();
  const run = () => scraper.execute(price, ad, () => cancelled).then(outcome);

  // Fails the latest request, then lets the backoff pass
  const failLast = async (error?: any) => {
    amazon.fail(amazon.requests.length - 1, error);
    await vi.runAllTimersAsync();
  };

  return { amazon, builder, scraper, ad, price, cancel, outcome, run, failLast, increment };
};

const flush = () => vi.advanceTimersByTimeAsync(0);

const calls = (increment: ReturnType<typeof vi.fn>, metric: string) =>
  increment.mock.calls.filter((call) => call[0] === metric);

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
    const { amazon, builder, ad, price, run } = setup();
    price.country.proxyType = "isp";
    run();

    expect(builder.buildUrl).toHaveBeenCalledWith(price.country, ad);
    expect(amazon.get).toHaveBeenCalledWith(
      "c1/dp/B0TESTASIN",
      "c1/ref",
      {
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
        isCancelled: expect.any(Function),
      },
      "isp",
      undefined
    );
  });

  it("passes the cancellation to the request", () => {
    const { amazon, cancel, run } = setup();
    run();

    expect(amazon.requests[0].callback.isCancelled?.()).toBe(false);
    cancel();
    expect(amazon.requests[0].callback.isCancelled?.()).toBe(true);
  });

  it("does not request a cancelled country", async () => {
    const { amazon, cancel, outcome, run } = setup();
    cancel();
    run();
    await flush();

    expect(amazon.get).not.toHaveBeenCalled();
    expect(outcome).toHaveBeenCalledWith(undefined);
  });

  describe("on success", () => {
    it("stores the price and dispatchFrom and returns data", async () => {
      const { amazon, builder, price, outcome, run } = setup({
        price: 24.99,
        dispatchFrom: "Amazon",
      });
      run();

      amazon.respond(0, html);
      await flush();

      expect(builder.trimHtml).toHaveBeenCalledWith(html);
      expect(price).toMatchObject({ value: 24.99, dispatchFrom: "Amazon" });
      expect(outcome).toHaveBeenCalledWith("data");
    });

    it("returns no_data for a country without an offer", async () => {
      const { amazon, price, outcome, run } = setup({ isCaptcha: false, isValid: true });
      run();

      amazon.respond(0, html);
      await flush();

      expect(price.value).toBeUndefined();
      expect(outcome).toHaveBeenCalledWith("no_data");
    });

    it("ignores a response that arrives after cancellation", async () => {
      const { amazon, price, cancel, outcome, run, increment } = setup();
      run();

      cancel();
      amazon.respond(0, html);
      await flush();

      expect(price.value).toBeUndefined();
      expect(outcome).toHaveBeenCalledWith(undefined);
      expect(increment).not.toHaveBeenCalled();
    });
  });

  describe("retries", () => {
    it.each([
      ["an empty response", { price: 10 }, ""],
      ["a captcha", { isCaptcha: true }, html],
      ["an invalid response", { isCaptcha: false, isValid: false }, html],
    ])("on %s", async (_name, result, data) => {
      const { amazon, price, outcome, run } = setup(result);
      run();

      amazon.respond(0, data);
      await flush();

      expect(price.failed).toBe(1);
      expect(outcome).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);
      expect(amazon.get).toHaveBeenCalledTimes(2);
      expect(amazon.requests[1].url).toBe("c1/dp/B0TESTASIN");
    });

    it("on a network error", async () => {
      const { amazon, price, run } = setup();
      run();

      amazon.fail(0);
      await flush();

      expect(price.failed).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(amazon.get).toHaveBeenCalledTimes(2);
    });

    it("on a parse error", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { amazon, builder, price, run } = setup();
      builder.build.mockImplementationOnce(() => {
        throw new Error("broken");
      });
      run();

      amazon.respond(0, html);
      await flush();

      expect(price.failed).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(amazon.get).toHaveBeenCalledTimes(2);
    });

    it("after an exponential backoff delay", async () => {
      const { amazon, price, run } = setup();
      price.failed = 2;
      run();

      amazon.fail(0);
      await flush();
      await vi.advanceTimersByTimeAsync(3999);
      expect(amazon.get).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(amazon.get).toHaveBeenCalledTimes(2);
    });

    it("not once cancelled during the backoff", async () => {
      const { amazon, cancel, outcome, run } = setup();
      run();

      amazon.fail(0);
      await flush();
      cancel();
      await vi.runAllTimersAsync();

      expect(amazon.get).toHaveBeenCalledTimes(1);
      expect(outcome).toHaveBeenCalledWith(undefined);
    });

    it("gives up after the attempt limit", async () => {
      const { amazon, price, outcome, run, failLast } = setup();
      run();

      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await failLast();

      expect(price.failed).toBe(MAX_FAILED_ATTEMPTS);
      expect(price.value).toBeUndefined();
      expect(amazon.get).toHaveBeenCalledTimes(MAX_FAILED_ATTEMPTS);
      expect(outcome).toHaveBeenCalledWith("given_up");
    });
  });

  it("returns deleted on 404 without retrying", async () => {
    const { amazon, price, outcome, run } = setup();
    run();

    amazon.fail(0, notFound);
    await vi.runAllTimersAsync();

    expect(price.failed).toBe(0);
    expect(amazon.get).toHaveBeenCalledTimes(1);
    expect(outcome).toHaveBeenCalledWith("deleted");
  });

  describe("metrics", () => {
    it.each([
      ["data", { price: 10 }],
      ["no_data", { isCaptcha: false, isValid: true }],
    ])("counts a response and an item as %s", async (result, buildResult) => {
      const { amazon, run, increment } = setup(buildResult);
      run();
      const labels = { country: "c1", outcome: result };

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
      run();

      amazon.respond(0, data);
      await flush();

      expect(increment).toHaveBeenCalledWith("responses", { country: "c1", outcome });
      expect(calls(increment, "items")).toHaveLength(0);
      expect(calls(increment, "item_attempts")).toHaveLength(0);
    });

    it("counts the attempts of a country that succeeded after failures", async () => {
      const { amazon, run, failLast, increment } = setup();
      run();

      await failLast();
      await failLast();
      amazon.respond(amazon.requests.length - 1, html);
      await flush();

      expect(increment).toHaveBeenCalledWith(
        "item_attempts",
        { country: "c1", outcome: "data" },
        3
      );
    });

    it("counts a deleted item", async () => {
      const { amazon, run, increment } = setup();
      run();

      amazon.fail(0, notFound);
      await flush();

      const labels = { country: "c1", outcome: "deleted" };
      expect(increment).toHaveBeenCalledWith("items", labels);
      expect(increment).toHaveBeenCalledWith("item_attempts", labels, 1);
    });

    it("counts a given up country with the failed attempts", async () => {
      const { run, failLast, increment } = setup();
      run();

      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await failLast();

      const labels = { country: "c1", outcome: "given_up" };
      expect(increment).toHaveBeenCalledWith("items", labels);
      expect(increment).toHaveBeenCalledWith("item_attempts", labels, MAX_FAILED_ATTEMPTS);
    });
  });

  describe("pdpSource", () => {
    const setupSources = (pdpSource: string) => {
      const amazon = fakeAmazonService();
      const aod = fakeAdBuilder({ price: 10 });
      const twister = fakeAdBuilder({ price: 20 });
      twister.buildUrl.mockImplementation((country, ad) => ({
        url: `${country.tld}/twister/${ad.asin}`,
        referer: `${country.tld}/dp/${ad.asin}`,
      }));
      twister.builder.stopAt = ["a", "b"];
      const metrics = { increment: vi.fn() } as unknown as MetricsService;
      const scraper = new AmazonPdpCountryScraper(
        amazon.service,
        { aod: aod.builder, twister: twister.builder },
        metrics
      );
      const price = buildPrice({ country: buildAmazonCountry({ tld: "c1", pdpSource }) });
      const outcome = vi.fn();
      const run = () => scraper.execute(price, buildAd(), () => false).then(outcome);

      return { amazon, aod, twister, price, outcome, run };
    };

    it("scrapes a twister country through twister with its stop markers", async () => {
      const { amazon, twister, price, outcome, run } = setupSources("twister");
      run();

      expect(amazon.requests[0].url).toBe("c1/twister/B0TESTASIN");
      expect(amazon.get.mock.calls[0][4]).toEqual(["a", "b"]);
      amazon.respond(0, html);
      await flush();

      expect(twister.build).toHaveBeenCalled();
      expect(price.value).toBe(20);
      expect(outcome).toHaveBeenCalledWith("data");
    });

    it("scrapes a country with an unknown pdpSource through AOD", () => {
      const { amazon, run } = setupSources("x");
      run();

      expect(amazon.requests[0].url).toBe("c1/dp/B0TESTASIN");
      expect(amazon.get.mock.calls[0][4]).toBeUndefined();
    });

    it("falls back to AOD on a twister 404", async () => {
      const { amazon, aod, price, outcome, run } = setupSources("twister");
      run();

      amazon.fail(0, notFound);
      await flush();

      expect(amazon.requests[1].url).toBe("c1/dp/B0TESTASIN");
      expect(price.failed).toBe(0);
      amazon.respond(1, html);
      await flush();

      expect(aod.build).toHaveBeenCalled();
      expect(price.value).toBe(10);
      expect(outcome).toHaveBeenCalledWith("data");
    });

    it("deletes the country on an AOD 404 after the fallback", async () => {
      const { amazon, outcome, run } = setupSources("twister");
      run();

      amazon.fail(0, notFound);
      await flush();
      amazon.fail(1, notFound);
      await flush();

      expect(outcome).toHaveBeenCalledWith("deleted");
    });
  });

  it("reads prices from the AOD fragment by default", () => {
    const amazon = fakeAmazonService();
    const scraper = new AmazonPdpCountryScraper(amazon.service);

    scraper.execute(buildPrice({ country: buildAmazonCountry({ tld: "c1" }) }), buildAd(), () => false);

    expect(amazon.requests[0].url).toBe(
      "c1/gp/product/ajax/aodAjaxMain/?asin=B0TESTASIN&pc=dp"
    );
  });
});
