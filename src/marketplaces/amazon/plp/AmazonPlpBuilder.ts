import type { Document, Element } from "domhandler";
import { AmazonPlpAd } from "@/marketplaces/amazon/types/amazon.types";
import { find, findAll, text } from "@/shared/utils/html";

export class AmazonPlpBuilder {
  build(document: Document, category: string) {
    const listItemSelector = "div[role='listitem']";
    const items = findAll(listItemSelector, document);

    const ads = items.reduce((accum: AmazonPlpAd[], item) => {
      const ad = this.buildItem(item, category);
      if (!ad) return accum;

      accum.push(ad);
      return accum;
    }, []);

    const subcategories = this.buildSubcategories(document);
    const hasNextPage = !!find("a.s-pagination-next", document);

    return {
      ads,
      subcategories,
      hasNextPage,
    };
  }

  private buildItem(item: Element, category: string) {
    const asin = item.attribs["data-asin"];
    const image = find("img", item)?.attribs.src;
    const name = text(find("a > h2 > span", item));

    if (!asin || !image || !name) return;

    return {
      asin,
      name,
      image,
      categoryName: category,
    };
  }

  private buildSubcategories(document: Document) {
    const list = find("ul#filter-n", document);
    const items = list && findAll("li[id].s-navigation-indent-2", list);

    if (!items) return [];
    return items
      .map((item) => item.attribs.id?.replace("/", "%3A"))
      .filter((id) => !!id) as string[];
  }
}
