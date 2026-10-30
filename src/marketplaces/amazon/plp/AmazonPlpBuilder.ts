import type { Document, Element } from "domhandler";
import { AmazonPlpAd } from "@/marketplaces/amazon/types/amazon.types";
import { detach, find, findAll, text } from "@/shared/utils/html";

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

    const hasResults = !!find("[data-component-type='s-search-results']", document);
    const isEmpty = !!find("[data-csa-c-content-id='messaging-messages-no-results']", document);

    return {
      isValid: hasResults && (ads.length > 0 || isEmpty),
      ads,
      lastPage: this.buildLastPage(document),
    };
  }

  private buildItem(item: Element, category: string) {
    const asin = item.attribs["data-asin"];
    const image = detach(find("img", item)?.attribs.src);
    const name = text(find("a > h2 > span", item));

    if (!asin || !image || !name) return;

    return {
      asin,
      name,
      image,
      categoryName: category,
    };
  }

  private buildLastPage(document: Document) {
    const pages = findAll(".s-pagination-item", document)
      .map((item) => Number(text(item)?.trim()))
      .filter((page) => page > 0);
    return Math.max(1, ...pages);
  }
}
