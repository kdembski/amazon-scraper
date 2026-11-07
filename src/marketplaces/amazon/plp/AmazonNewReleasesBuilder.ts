import type { Document, Element } from "domhandler";
import _ from "lodash";
import { detach, find, findAll, text } from "@/shared/utils/html";

export class AmazonNewReleasesBuilder {
  stopAt = ["a-pagination", "</ul>"];

  build(document: Document, category: string) {
    const isValid = !!find("[class*='zg-browse-group']", document);
    const items = findAll("#gridItemRoot [data-asin]", document);

    const ads = _.compact(items.map((item) => this.buildItem(item, category)));

    return {
      isValid,
      ads,
      nodes: this.buildNodes(document, category),
      hasNextPage: !!find("a[href*='pg=2']", document),
    };
  }

  private buildItem(item: Element, category: string) {
    const asin = item.attribs["data-asin"];
    const image = detach(find("img", item)?.attribs.src);
    const name = text(find("[class*='p13n-sc-css-line-clamp']", item))?.trim();

    if (!asin || !image || !name) return;

    return { asin, name, image, categoryName: category };
  }

  private buildNodes(document: Document, category: string) {
    const prefix = `/gp/new-releases/${category}/`;
    const links = findAll(`a[href^='${prefix}']`, document);

    return links
      .map((link) => link.attribs.href.slice(prefix.length))
      .map((path) => path.match(/^\d+/)?.[0])
      .filter((node): node is string => !!node);
  }
}
