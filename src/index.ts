import { OlxPageScraper } from "@/OlxPageScraper";
import { ApiService } from "@/ApiService";
import { WebSocketService } from "@/WebSocketService";
import { OlxAdCategory } from "@/types/olx.types";
import { configDotenv } from "dotenv";

configDotenv();

const run = async () => {
  const collectedIds: string[] = [];
  const scraper = new OlxPageScraper();
  const api = ApiService.getInstance();
  const categoryWs = new WebSocketService("olx/ads/categories");

  let categories = await api.get<OlxAdCategory[]>("olx/ads/categories");

  categoryWs.onmessage = (event) => {
    if (!event.data) return;
    categories = JSON.parse(event.data);
  };

  const getCategoryNames = () => categories.map((category) => category.name);

  setInterval(() => {
    getCategoryNames().forEach(async (category) => {
      try {
        // Clean collected ads
        if (collectedIds.length > 1000) {
          collectedIds.length = 100;
        }

        // Scrap all plp ads and take first one (newest)
        const plpAds = await scraper.scrapPlp(category);
        const plpAd = plpAds?.[0];
        if (!plpAd) return;

        // Check if ad has been already scraped
        const isNew = !collectedIds.some(
          (collectedId) => collectedId === plpAd.olxId
        );
        if (!isNew) return;

        collectedIds.unshift(plpAd.olxId);

        // Scrap pdp of that ad
        const pdpAd = await scraper.scrapPdp(plpAd.url);
        if (!pdpAd) return;

        // Build olx ad create input and send post request
        const ad = { ...plpAd, ...pdpAd };

        console.log(ad);
        await api.post("olx/ads", ad);
      } catch (error: any) {
        console.error(error?.message);
      }
    });
  }, 30000);
};

run();
