import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "domhandler";
import { AmazonPlpPageFetcher } from "@/marketplaces/amazon/plp/AmazonPlpPageFetcher";
import type { MetricsService } from "@/shared/metrics/MetricsService";
import { find } from "@/shared/utils/html";
import { MAX_FAILED_ATTEMPTS } from "@/shared/utils/retry";
import { fakeAmazonService, fakeScraperConfigService } from "@@tests/support/fakes";

const ad = { asin: "B0A", name: "Product", image: "B0A.jpg", categoryName: "electronics" };
const valid = { isValid: true, ads: [ad] };
const invalid = { isValid: false, ads: [] };

const setup = ({ batchSize = 50 } = {}) => {
  const amazon = fakeAmazonService();
  const config = fakeScraperConfigService({ batchSize });
  const increment = vi.fn();
  const fetcher = new AmazonPlpPageFetcher(
    amazon.service,
    config.service,
    { increment } as unknown as MetricsService
  );
  return { amazon, fetcher, increment };
};

const responses = (increment: ReturnType<typeof vi.fn>) =>
  increment.mock.calls
    .filter(([metric]) => metric === "responses")
    .map(([, labels]) => labels.outcome);

describe("AmazonPlpPageFetcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the built page of a valid response", async () => {
    const { amazon, fetcher, increment } = setup();
    const build = vi.fn((document: Document) => ({ ...valid, id: find("#x", document)?.attribs.id }));

    const result = fetcher.fetch("pl/s?i=toys", "pl/b?node=1", build);
    await vi.advanceTimersByTimeAsync(0);
    amazon.respond(0, `<div id="x"></div>`);

    expect(await result).toEqual({ page: { ...valid, id: "x" }, failed: 0 });
    expect(amazon.requests[0]).toMatchObject({ url: "pl/s?i=toys", referer: "pl/b?node=1" });
    expect(increment).toHaveBeenCalledWith("responses", { country: "pl", outcome: "data" });
  });

  it("counts a valid page without ads as no_data", async () => {
    const { amazon, fetcher, increment } = setup();

    const result = fetcher.fetch("url", "ref", () => ({ isValid: true, ads: [] }));
    await vi.advanceTimersByTimeAsync(0);
    amazon.respond(0, "<html></html>");

    expect(await result).toEqual({ page: { isValid: true, ads: [] }, failed: 0 });
    expect(responses(increment)).toEqual(["no_data"]);
    expect(amazon.requests).toHaveLength(1);
  });

  it("retries an empty response, an invalid page, a throwing build and a failed request", async () => {
    const { amazon, fetcher, increment } = setup();
    const build = vi
      .fn()
      .mockReturnValueOnce(invalid)
      .mockImplementationOnce(() => {
        throw new Error("broken");
      })
      .mockReturnValue(valid);

    const result = fetcher.fetch("url", "ref", build);
    await vi.advanceTimersByTimeAsync(0);
    amazon.respond(0, "");
    await vi.advanceTimersByTimeAsync(60 * 1000);
    amazon.respond(1, "<html></html>");
    await vi.advanceTimersByTimeAsync(60 * 1000);
    amazon.respond(2, "<html></html>");
    await vi.advanceTimersByTimeAsync(60 * 1000);
    amazon.fail(3);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    amazon.respond(4, "<html></html>");

    expect(await result).toEqual({ page: valid, failed: 4 });
    expect(amazon.requests).toHaveLength(5);
    expect(responses(increment)).toEqual(["empty", "invalid", "invalid", "data"]);
  });

  it("gives up after MAX_FAILED_ATTEMPTS", async () => {
    const { amazon, fetcher } = setup();

    const result = fetcher.fetch("url", "ref", () => valid);
    for (let index = 0; index < MAX_FAILED_ATTEMPTS; index++) {
      await vi.advanceTimersByTimeAsync(60 * 1000);
      amazon.fail(index);
    }

    expect(await result).toEqual({ page: undefined, failed: MAX_FAILED_ATTEMPTS });
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(amazon.requests).toHaveLength(MAX_FAILED_ATTEMPTS);
  });

  it("waits while the request queue is full", async () => {
    const { amazon, fetcher } = setup({ batchSize: 2 });
    amazon.queueService.queue.push(vi.fn(), vi.fn());

    fetcher.fetch("url", "ref", () => valid);
    await vi.advanceTimersByTimeAsync(3000);
    expect(amazon.requests).toHaveLength(0);

    amazon.queueService.queue.pop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(amazon.requests).toHaveLength(1);
  });
});
