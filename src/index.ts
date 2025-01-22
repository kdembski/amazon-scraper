import { configDotenv } from "dotenv";
import { AmazonPdpScraper } from "./amazon/AmazonPdpScraper";
import { ApiService } from "./ApiService";
import { AmazonAd, Country } from "./types/amazon.types";
import { AmazonPlpScraper } from "@/amazon/AmazonPlpScraper";

configDotenv();
// Ignore the certificate
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

const run = async () => {
  scrapPlp();
};

const scrapPlp = () => {
  //new AmazonPlpScraper("electronics", 400).execute();
  new AmazonPlpScraper("computers", 400).execute();
  new AmazonPlpScraper("videogames", 400).execute();
};

const scrapPdp = async () => {
  const apiService = ApiService.getInstance();
  const ads = await apiService.get<AmazonAd[]>("amazon/ads/scrap");
  const countries = await apiService.get<Country[]>("countries");

  const promises = ads.map((ad) => {
    return new AmazonPdpScraper(ad, countries).execute();
  });

  await Promise.all(promises);
  scrapPdp();
};

run();
