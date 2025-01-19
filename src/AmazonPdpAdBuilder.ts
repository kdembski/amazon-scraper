import { AmazonPdpAd } from "@/types/amazon.types";
import { JSDOM } from "jsdom";

export class AmazonPdpAdBuilder {
  private _ad?: AmazonPdpAd;

  build(dom: JSDOM) {
    const userLink = dom.window.document.querySelector(
      "a[data-testid='user-profile-link']"
    );
    const amazonUserId = userLink
      ?.getAttribute("href")
      ?.replace("oferty", "")
      .replace("uzytkownik", "")
      .replaceAll("/", "");

    if (!amazonUserId) return this;

    this._ad = {
      amazonUserId,
    };

    return this;
  }

  get ad() {
    return this._ad;
  }
}
