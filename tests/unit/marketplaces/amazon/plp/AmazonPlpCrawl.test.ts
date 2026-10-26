import { describe, expect, it } from "vitest";
import { AmazonPlpCrawl } from "@/marketplaces/amazon/plp/AmazonPlpCrawl";
import { fakeApiService } from "@@tests/support/fakes";

const ad = (asin: string) => ({
  asin,
  name: `Product ${asin}`,
  image: `${asin}.jpg`,
  categoryName: "electronics",
});

describe("AmazonPlpCrawl", () => {
  it("keeps the category and whether to scrape all pages", () => {
    const crawl = new AmazonPlpCrawl("toys", true, fakeApiService().service);

    expect(crawl.category).toBe("toys");
    expect(crawl.allPages).toBe(true);
  });

  it("sends only ads not sent before in the run", () => {
    const api = fakeApiService();
    const crawl = new AmazonPlpCrawl("electronics", false, api.service);

    expect(crawl.post([ad("B0A"), ad("B0B")])).toBe(2);
    expect(crawl.post([ad("B0B"), ad("B0C")])).toBe(1);

    expect(api.post.mock.calls).toEqual([
      ["amazon/ads", [ad("B0A"), ad("B0B")]],
      ["amazon/ads", [ad("B0C")]],
    ]);
  });

  it("sends nothing when every ad was sent before", () => {
    const api = fakeApiService();
    const crawl = new AmazonPlpCrawl("electronics", false, api.service);
    crawl.post([ad("B0A")]);

    expect(crawl.post([ad("B0A")])).toBe(0);
    expect(crawl.post([])).toBe(0);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
