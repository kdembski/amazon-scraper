import { AmazonPlpAd } from "@/marketplaces/amazon/types/amazon.types";

export class AmazonPlpBuilder {
  build(document: Document, category: string) {
    const listItemSelector = "div[role='listitem']";
    const items = [...document.querySelectorAll(listItemSelector)];

    const ads = items.reduce((accum: AmazonPlpAd[], item) => {
      const ad = this.buildItem(item, category);
      if (!ad) return accum;

      accum.push(ad);
      return accum;
    }, []);

    const subcategories = this.buildSubcategories(document);
    const hasNextPage = !!document.querySelector("a.s-pagination-next");

    return {
      ads,
      subcategories,
      hasNextPage,
    };
  }

  private buildItem(item: Element, category: string) {
    const asin = item.getAttribute("data-asin");
    const image = item.querySelector("img")?.getAttribute("src");
    const name = item.querySelector("a > h2 > span")?.textContent;

    if (!asin || !image || !name) return;

    return {
      asin,
      name,
      image,
      categoryName: category,
    };
  }

  private buildSubcategories(document: Document) {
    const list = document.querySelector("ul#filter-n");
    const items = list?.querySelectorAll("li[id].s-navigation-indent-2");

    if (!items) return [];
    return [...items]
      .map((item) => item.getAttribute("id")?.replace("/", "%3A"))
      .filter((id) => !!id) as string[];
  }
}
