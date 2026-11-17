import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmazonPlpScraper } from "@/marketplaces/amazon/plp/AmazonPlpScraper";
import { AmazonPlpCrawl } from "@/marketplaces/amazon/plp/AmazonPlpCrawl";
import type { AmazonPlpPageScraper } from "@/marketplaces/amazon/plp/AmazonPlpPageScraper";
import { fakeApiService } from "@@tests/support/fakes";

const electronics = { id: 1, name: "electronics", scrapedAt: null };

// Every category scrape stays pending until the test finishes it
const setup = () => {
  const api = fakeApiService();
  const finishers: (() => void)[] = [];
  const pageExecute = vi.fn(
    (_crawl: AmazonPlpCrawl) => new Promise<void>((resolve) => finishers.push(resolve))
  );
  const pageScraper = { execute: pageExecute } as unknown as AmazonPlpPageScraper;
  const scraper = new AmazonPlpScraper(api.service, pageScraper);
  return { api, pageExecute, finishers, scraper };
};

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("AmazonPlpScraper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is the amazon marketplace", () => {
    expect(setup().scraper.marketplace).toBe("amazon");
  });

  it("scrapes the next category right after the previous one finishes", async () => {
    const { api, pageExecute, finishers, scraper } = setup();
    api.get.mockResolvedValue(electronics);

    scraper.execute();
    await flush();

    expect(api.get).toHaveBeenCalledWith("amazon/ads/categories/scrap");
    expect(pageExecute).toHaveBeenCalledWith(expect.objectContaining({ category: "electronics" }));
    expect(api.get).toHaveBeenCalledTimes(1);

    finishers[0]();
    await flush();

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(pageExecute).toHaveBeenCalledTimes(2);
  });

  it("asks for the category again a minute after loading fails", async () => {
    const { api, pageExecute, scraper } = setup();
    api.get.mockRejectedValueOnce(new Error("down")).mockResolvedValue(electronics);

    scraper.execute();
    await flush();
    expect(api.get).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(59 * 1000);
    expect(api.get).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(pageExecute).toHaveBeenCalledWith(expect.objectContaining({ category: "electronics" }));
  });

  it("asks for the category again a minute after scraping it fails", async () => {
    const { api, pageExecute, scraper } = setup();
    api.get.mockResolvedValue(electronics);
    pageExecute.mockRejectedValueOnce(new Error("down"));

    scraper.execute();
    await vi.advanceTimersByTimeAsync(59 * 1000);
    expect(pageExecute).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(pageExecute).toHaveBeenCalledTimes(2);
  });
});
