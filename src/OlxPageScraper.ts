import axios from "axios";
import { JSDOM } from "jsdom";
import { OlxPlpAdBuilder } from "@/OlxPlpAdBuilder";
import { OlxPdpAdBuilder } from "@/OlxPdpAdBuilder";

export class OlxPageScraper {
  private baseUrl = "https://www.olx.pl/";
  private query = "/?search%5Border%5D=created_at:desc";

  async scrapPlp(url: string) {
    const response = await axios.get(this.baseUrl + url + this.query);
    const dom = new JSDOM(response.data);
    const cards = [
      ...dom.window.document.querySelectorAll("div[data-testid='l-card']"),
    ];

    const ads = [];
    const builder = new OlxPlpAdBuilder();

    for (const card of cards) {
      const featured = card.querySelector("[data-testid='adCard-featured']");
      if (featured) continue;

      builder.build(card, url);
      if (!builder.ad) continue;

      ads.push(builder.ad);
    }

    return ads;
  }

  async scrapPdp(url: string) {
    const response = await axios.get(url);
    const dom = new JSDOM(response.data);

    const builder = new OlxPdpAdBuilder();
    builder.build(dom);

    return builder.ad;
  }
}
