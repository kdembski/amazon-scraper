import { AmazonPlpAd } from "@/marketplaces/amazon/types/amazon.types";

export class AmazonNewReleasesBuilder {
  build(document: Document, category: string) {
    const isValid = !!document.querySelector("[class*='zg-browse-group']");
    const items = [...document.querySelectorAll("#gridItemRoot [data-asin]")];

    const ads = items.reduce((accum: AmazonPlpAd[], item) => {
      const ad = this.buildItem(item, category);
      if (ad) accum.push(ad);
      return accum;
    }, []);

    return {
      isValid,
      ads,
      nodes: this.buildNodes(document, category),
      hasNextPage: !!document.querySelector("a[href*='pg=2']"),
    };
  }

  private buildItem(item: Element, category: string) {
    const asin = item.getAttribute("data-asin");
    const image = item.querySelector("img")?.getAttribute("src");
    const name = item
      .querySelector("[class*='p13n-sc-css-line-clamp']")
      ?.textContent?.trim();

    if (!asin || !image || !name) return;

    return { asin, name, image, categoryName: category };
  }

  private buildNodes(document: Document, category: string) {
    const prefix = `/gp/new-releases/${category}/`;
    const links = document.querySelectorAll(`a[href^='${prefix}']`);

    return [...links]
      .map((link) => link.getAttribute("href")!.slice(prefix.length))
      .map((path) => path.match(/^\d+/)?.[0])
      .filter((node): node is string => !!node);
  }
}
