import { afterEach, describe, expect, it } from "vitest";
import { plpPage } from "@@tests/support/html";
import { Process, spawnScraper } from "@@tests/support/e2e";

describe("PLP process", () => {
  let scraper: Process | undefined;

  afterEach(async (context) => {
    if (context.task.result?.state === "fail") console.log(scraper?.output());
    await scraper?.stop();
  });

  it("scrapes the category and sends the ads to the backend", async () => {
    scraper = await spawnScraper(["-t", "plp", "-c", "100"], ({ backend, amazon }) => {
      backend.on("GET", "amazon/ads/categories/scrap", { id: 1, name: "electronics" });
      amazon.respond(({ url }) =>
        url === "pl/s?i=electronics&s=date-desc-rank"
          ? plpPage({ asins: ["B0ROOT1"] })
          : { status: 404 }
      );
    });

    const post = await scraper.backend.waitFor("POST", "amazon/ads", 30 * 1000);

    expect(post.body).toEqual([
      {
        asin: "B0ROOT1",
        name: "Product B0ROOT1",
        image: "https://m.media-amazon.com/images/I/B0ROOT1.jpg",
        categoryName: "electronics",
      },
    ]);
  });
});
