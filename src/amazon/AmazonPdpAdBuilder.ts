import { AmazonPdpAd } from "@/types/amazon.types";

export class AmazonPdpAdBuilder {
  private _ad?: AmazonPdpAd;

  build(document: Document) {
    const price = this.getPrice(document);

    this._ad = {
      price,
    };

    return this;
  }

  get ad() {
    return this._ad;
  }

  private getPrice(document: Document) {
    let price: any;
    const json = document.querySelector(
      "#twisterPlusWWDesktop > div"
    )?.innerHTML;

    if (json?.startsWith("{") && json.endsWith("}")) {
      price = JSON.parse(json)?.["desktop_buybox_group_1"]?.[0]?.priceAmount;
    }

    const inputValue = document
      .querySelector("#twister-plus-price-data-price")
      ?.getAttribute("value");

    if (inputValue) {
      price = inputValue;
    }

    return price ? parseFloat(price) : undefined;
  }
}
