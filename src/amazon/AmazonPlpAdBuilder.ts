import { AmazonPlpAd } from "@/types/amazon.types";

export class AmazonPlpAdBuilder {
  private _ad?: AmazonPlpAd;

  build(item: Element, category: string) {
    const asin = item.getAttribute("data-asin");

    if (!asin) return this;

    this._ad = {
      asin,
      categoryName: category,
    };

    return this;
  }

  get ad() {
    return this._ad;
  }
}
