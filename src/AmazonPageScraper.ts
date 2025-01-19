import axios from "axios";
import { JSDOM } from "jsdom";
import { AmazonPdpAdBuilder } from "@/AmazonPdpAdBuilder";
import { AmazonService } from "./AmazonService";
import { AmazonPlpAdBuilder } from "./AmazonPlpAdBuilder";
import { AmazonPlpAd } from "./types/amazon.types";

export class AmazonPageScraper {
  private baseUrl = "https://www.amazon.pl/";

  async scrapMultiplePlps(category: string, pages: number) {
    for (let i = 0; i < pages; i++) {
      this.scrapPlp(category, i);
    }
  }

  async scrapPlp(category: string, page: number) {
    const url = `${this.baseUrl}s?i=${category}&s=date-desc-rank&ref=sr_st_date-desc-rank&page=${page}`;
    const service = AmazonService.getInstance();
    const builder = new AmazonPlpAdBuilder();
    const ads: AmazonPlpAd[] = [];

    return new Promise<void>((resolve) => {
      service.get<string>(url, {
        onSuccess: (data) => {
          const listItemSelector = "div[role='listitem']";
          const dom = new JSDOM(data);
          const items = [
            ...dom.window.document.querySelectorAll(listItemSelector),
          ];

          for (const item of items) {
            builder.build(item, category);
            if (!builder.ad) continue;

            ads.push(builder.ad);
          }

          console.log("collected ads: " + ads.length);

          resolve();
        },
        onError: () => {
          setTimeout(() => {
            this.scrapPlp(category, page);
          }, 200);
        },
      });
    });
  }

  async scrapPdp(url: string) {
    const response = await axios.get(url);
    const dom = new JSDOM(response.data);

    const builder = new AmazonPdpAdBuilder();
    builder.build(dom);

    return builder.ad;
  }
}
