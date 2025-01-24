import { AmazonPlpAd } from "@/types/amazon.types";

export class AmazonPlpAdBuilder {
  private _ad?: AmazonPlpAd;

  build(item: Element, category: string) {
    const asin = item.getAttribute("data-asin");
    const image = item.querySelector("img")?.getAttribute("src");
    const name = item.querySelector("a > h2 > span")?.textContent;

    if (!asin || !image || !name) return this;

    this._ad = {
      asin,
      name,
      image,
      categoryName: category,
    };

    return this;
  }

  get ad() {
    return this._ad;
  }
}
