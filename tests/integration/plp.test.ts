import _ from "lodash";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_FAILED_ATTEMPTS } from "@/helpers/retry";
import { plpPage } from "@@tests/support/html";
import {
  bootScraper,
  sleep,
  startWorld,
  stopWorld,
  World,
} from "@@tests/support/integration";

const root = "pl/s?i=electronics&s=date-desc-rank";
const sub = (id: string) => `pl/s?i=electronics&rh=n%3A${id}&s=date-desc-rank`;

const ad = (asin: string) => ({
  asin,
  name: `Product ${asin}`,
  image: `https://m.media-amazon.com/images/I/${asin}.jpg`,
  categoryName: "electronics",
});

describe("PLP", () => {
  let world: World;

  beforeEach(async () => {
    world = await startWorld();
    world.backend.on("GET", "amazon/ads/categories/scrap", {
      id: 1,
      name: "electronics",
    });
  });

  afterEach(() => stopWorld(world));

  const scrape = () => bootScraper(["-t", "plp", "-c", "100"]).scraper.execute();

  const waitForPosts = async (count: number) => {
    await world.backend.waitFor("POST", "amazon/ads");
    await expect
      .poll(() => world.backend.find("POST", "amazon/ads").length)
      .toBe(count);
    return world.backend.find("POST", "amazon/ads").map((post) => post.body);
  };

  it("sends the newest ads of the category and its subcategories", async () => {
    const pages: Record<string, string> = {
      [root]: plpPage({
        asins: ["B0ROOT1", "B0ROOT2"],
        path: ["n/10"],
        subcategories: ["n/11", "n/12"],
      }),
      [sub("11")]: plpPage({
        asins: ["B0SUB11"],
        path: ["n/10", "n/11"],
        subcategories: ["n/12"],
      }),
      [sub("12")]: plpPage({ asins: ["B0SUB12"], path: ["n/10", "n/12"] }),
    };
    world.amazon.respond(({ url }) => pages[url] ?? { status: 404 });
    scrape();

    const posts = await waitForPosts(3);

    expect(posts).toContainEqual([ad("B0ROOT1"), ad("B0ROOT2")]);
    expect(posts).toContainEqual([ad("B0SUB11")]);
    expect(posts).toContainEqual([ad("B0SUB12")]);
    const urls = world.amazon.requests.map((request) => request.url);
    expect(urls.sort()).toEqual([root, sub("11"), sub("12")].sort());
    expect(world.amazon.requests[0].headers.referer).toMatch(
      /^https:\/\/www\.amazon\.pl\/b\?node=\d+$/
    );
  });

  it("follows the pagination up to 10 pages", async () => {
    world.amazon.respond(({ url }) => {
      const number = Number(url.match(/&page=(\d+)/)?.[1] ?? 1);
      return plpPage({ asins: [`B0PAGE${number}`], next: true });
    });
    scrape();

    const posts = await waitForPosts(10);
    await sleep(200);

    expect(posts.flat().map((ad) => ad.asin).sort()).toEqual(
      _.range(1, 11).map((number) => `B0PAGE${number}`).sort()
    );
    expect(world.amazon.requests).toHaveLength(10);
  });

  it("retries a listing without ads", async () => {
    let attempts = 0;
    world.amazon.respond(() =>
      attempts++ === 0 ? plpPage() : plpPage({ asins: ["B0ROOT1"] })
    );
    scrape();

    const posts = await waitForPosts(1);

    expect(posts).toEqual([[ad("B0ROOT1")]]);
    expect(world.amazon.requests).toHaveLength(2);
  });

  it("gives up on a listing after the attempt limit", async () => {
    world.amazon.respond(() => ({ status: 503 }));
    scrape();

    await expect
      .poll(() => world.amazon.requests.length)
      .toBe(MAX_FAILED_ATTEMPTS);
    await sleep(200);

    expect(world.amazon.requests).toHaveLength(MAX_FAILED_ATTEMPTS);
    expect(world.backend.find("POST", "amazon/ads")).toHaveLength(0);
  });
});
