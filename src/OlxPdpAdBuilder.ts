import { OlxPdpAd } from "@/types/olx.types";
import { JSDOM } from "jsdom";

export class OlxPdpAdBuilder {
  private _ad?: OlxPdpAd;

  build(dom: JSDOM) {
    const userLink = dom.window.document.querySelector(
      "a[data-testid='user-profile-link']"
    );
    const olxUserId = userLink
      ?.getAttribute("href")
      ?.replace("oferty", "")
      .replace("uzytkownik", "")
      .replaceAll("/", "");

    if (!olxUserId) return this;

    this._ad = {
      olxUserId,
    };

    return this;
  }

  get ad() {
    return this._ad;
  }
}
