export class AmazonPlpAdBuilder {
  build(item: Element, category: string) {
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
}
