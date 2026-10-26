import { describe, expect, it } from "vitest";
import { AmazonPlpBuilder } from "@/marketplaces/amazon/plp/AmazonPlpBuilder";
import { pagination, plpPage, toDocument } from "@@tests/support/html";

const builder = new AmazonPlpBuilder();
const build = (body: string, category = "electronics") =>
  builder.build(toDocument(body), category);

const image = "https://m.media-amazon.com/images/I/test.jpg";

const listItem = ({
  asin = "B0TESTASIN",
  src = image,
  name = "Test product",
} = {}) => `
  <div role="listitem" ${asin ? `data-asin="${asin}"` : ""}>
    ${src ? `<img src="${src}" />` : "<img />"}
    <a href="/dp/${asin}"><h2>${name ? `<span>${name}</span>` : ""}</h2></a>
  </div>
`;

const results = (body: string) =>
  `<div data-component-type="s-search-results">${body}</div>`;

describe("AmazonPlpBuilder", () => {
  it("is invalid without search results", () => {
    expect(build(`<div id="search"></div>`)).toEqual({
      isValid: false,
      ads: [],
      lastPage: 1,
    });
  });

  it("is invalid when search results have no products and no empty message", () => {
    expect(build(results("")).isValid).toBe(false);
  });

  it("is valid and empty with the no results message", () => {
    expect(build(plpPage({ empty: true }))).toEqual({
      isValid: true,
      ads: [],
      lastPage: 1,
    });
  });

  it("is valid with products", () => {
    expect(build(results(listItem())).isValid).toBe(true);
  });

  it.each([2, 11, 400])("reads the last page %i from the pagination", (lastPage) => {
    expect(build(results(listItem()) + pagination(lastPage)).lastPage).toBe(lastPage);
  });

  it("has one page without pagination", () => {
    expect(build(results(listItem())).lastPage).toBe(1);
  });

  it("builds ads from list items", () => {
    const body = results(`
      ${listItem()}
      ${listItem({ asin: "B0SECOND", name: "Second product" })}
    `);

    expect(build(body, "toys").ads).toEqual([
      { asin: "B0TESTASIN", name: "Test product", image, categoryName: "toys" },
      { asin: "B0SECOND", name: "Second product", image, categoryName: "toys" },
    ]);
  });

  it.each([
    ["asin", { asin: "" }],
    ["image", { src: "" }],
    ["name", { name: "" }],
  ])("skips items without %s", (_field, overrides) => {
    const body = results(`${listItem(overrides)}${listItem({ asin: "B0VALID" })}`);
    expect(build(body).ads.map((ad) => ad.asin)).toEqual(["B0VALID"]);
  });
});
