import { describe, expect, it } from "vitest";
import { AmazonNewReleasesBuilder } from "@/marketplaces/amazon/plp/AmazonNewReleasesBuilder";
import { captchaPage, newReleasesPage, toDocument } from "@@tests/support/html";

const builder = new AmazonNewReleasesBuilder();
const build = (body: string) => builder.build(toDocument(body), "electronics");

describe("AmazonNewReleasesBuilder", () => {
  it("treats a page without the browse tree as invalid", () => {
    expect(build(captchaPage)).toEqual({
      isValid: false,
      ads: [],
      nodes: [],
      hasNextPage: false,
    });
  });

  it("accepts a ranking without products", () => {
    expect(build(newReleasesPage())).toMatchObject({ isValid: true, ads: [] });
  });

  it("builds ads from the ranking items", () => {
    expect(build(newReleasesPage({ asins: ["B0TEST1", "B0TEST2"] })).ads).toEqual([
      {
        asin: "B0TEST1",
        name: "Product B0TEST1",
        image: "https://images-eu.ssl-images-amazon.com/images/I/B0TEST1.jpg",
        categoryName: "electronics",
      },
      expect.objectContaining({ asin: "B0TEST2" }),
    ]);
  });

  it.each([
    ["asin", `<div data-asin=""><img src="i.jpg" /><div class="p13n-sc-css-line-clamp-3">Name</div></div>`],
    ["image", `<div data-asin="B0TEST1"><img /><div class="p13n-sc-css-line-clamp-3">Name</div></div>`],
    ["name", `<div data-asin="B0TEST1"><img src="i.jpg" /></div>`],
  ])("skips an item without %s", (_name, item) => {
    expect(build(`<div id="gridItemRoot">${item}</div>`).ads).toEqual([]);
  });

  it("returns the nodes of the category from the browse tree", () => {
    const body = `
      ${newReleasesPage({ nodes: ["111", "222"] })}
      <a href="/gp/new-releases/electronics/ref=zg_bsnr_nav">Parent</a>
      <a href="/gp/new-releases/toys/333/ref=zg_bsnr_nav">Other category</a>
    `;
    expect(build(body).nodes).toEqual(["111", "222"]);
  });

  it.each([true, false])("detects page 2 (%s)", (next) => {
    expect(build(newReleasesPage({ next })).hasNextPage).toBe(next);
  });
});
