import { configDotenv } from "dotenv";
import { AmazonPdpScraper } from "./amazon/AmazonPdpScraper";
import { ApiService } from "./ApiService";
import { AmazonAd, Country } from "./types/amazon.types";

configDotenv();
// Ignore the certificate
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

const run = async () => {
  try {
    const apiService = ApiService.getInstance();
    const ads = await apiService.get<AmazonAd[]>("amazon/ads/scrap");
    const countries = await apiService.get<Country[]>("countries");

    const promises = ads.map((ad) => {
      const pdpScraper = new AmazonPdpScraper(ad, countries);
      return pdpScraper.execute();
    });

    await Promise.all(promises);
    run();
  } catch (e) {
    console.log(e);
  }
};

run();
