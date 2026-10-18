import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmazonPdpCountryScraper } from "@/scrapers/abstract/AmazonPdpCountryScraper";
import { MAX_FAILED_ATTEMPTS } from "@/shared/utils/retry";
import { Country } from "@/shared/types/Country";
import { AmazonAd, AmazonAdPrice } from "@/types/amazon.types";

class TestScraper extends AmazonPdpCountryScraper {
  execute = vi.fn();

  runRetry(...args: Parameters<AmazonPdpCountryScraper["execute"]>) {
    this.retry(...args);
  }
}

const ad: AmazonAd = { id: 1, asin: "B000000001" };
const buildPrice = (failed: number): AmazonAdPrice => ({
  country: { id: 1, code: "de" } as Country,
  pending: false,
  complete: false,
  deleted: false,
  adDeleted: false,
  failed,
});

describe("AmazonPdpCountryScraper.retry", () => {
  const priceHelper = {
    isComplete: vi.fn((prices: AmazonAdPrice[]) =>
      prices.every((price) => price.complete)
    ),
    isDeleted: vi.fn(() => false),
    sendCompletedPrices: vi.fn(),
  };
  const scraper = new TestScraper({} as any, {} as any, priceHelper as any);
  const resolveAd = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("retries after an exponential backoff delay", () => {
    const price = buildPrice(3);
    scraper.runRetry(price, ad, [price], resolveAd);

    vi.advanceTimersByTime(3999);
    expect(scraper.execute).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(scraper.execute).toHaveBeenCalledWith(price, ad, [price], resolveAd);
  });

  it("gives up on the country after the attempt limit", () => {
    const price = buildPrice(MAX_FAILED_ATTEMPTS);
    scraper.runRetry(price, ad, [price], resolveAd);
    vi.runAllTimers();

    expect(scraper.execute).not.toHaveBeenCalled();
    expect(price.complete).toBe(true);
    expect(price.value).toBeUndefined();
  });

  it("completes the ad when the given-up country was the last one", () => {
    const done = { ...buildPrice(0), complete: true, value: 10 };
    const price = buildPrice(MAX_FAILED_ATTEMPTS);
    scraper.runRetry(price, ad, [done, price], resolveAd);

    expect(priceHelper.sendCompletedPrices).toHaveBeenCalledWith(
      [done, price],
      ad
    );
    expect(resolveAd).toHaveBeenCalled();
  });

  it("waits for other countries before completing the ad", () => {
    const other = buildPrice(0);
    const price = buildPrice(MAX_FAILED_ATTEMPTS);
    scraper.runRetry(price, ad, [other, price], resolveAd);

    expect(priceHelper.sendCompletedPrices).not.toHaveBeenCalled();
    expect(resolveAd).not.toHaveBeenCalled();
  });
});
