import { describe, expect, it } from "vitest";
import { AmazonPlpBuilder } from "@/builders/AmazonPlpBuilder";
import { toDocument } from "@/__fixtures__/html";

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

describe("AmazonPlpBuilder", () => {
  it("returns nothing for an empty page", () => {
    expect(build(`<div id="search"></div>`)).toEqual({
      ads: [],
      subcategories: [],
    });
  });

  it("builds ads from list items", () => {
    const body = `
      ${listItem()}
      ${listItem({ asin: "B0SECOND", name: "Second product" })}
    `;

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
    const body = `${listItem(overrides)}${listItem({ asin: "B0VALID" })}`;
    expect(build(body).ads.map((ad) => ad.asin)).toEqual(["B0VALID"]);
  });

  it("builds subcategory ids with an encoded separator", () => {
    const body = `
      <ul id="filter-n">
        <li id="n/20788222031"><a>Laptops</a></li>
        <li id="n/20788223031"><a>Tablets</a></li>
        <li><a>Header without id</a></li>
      </ul>
    `;

    expect(build(body).subcategories).toEqual([
      "n%3A20788222031",
      "n%3A20788223031",
    ]);
  });

  it("ignores li elements outside the category filter", () => {
    const body = `<ul id="filter-p"><li id="p_123/abc"></li></ul>`;
    expect(build(body).subcategories).toEqual([]);
  });
});
