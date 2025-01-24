import { configDotenv } from "dotenv";
import { program } from "commander";
import { AmazonPlpScraper } from "@/scrapers/AmazonPlpScraper";
import { AmazonPdpScraper } from "@/scrapers/AmazonPdpScraper";
import { ApiService } from "@/services/ApiService";
import { AmazonAd, Country } from "@/types/amazon.types";

configDotenv();
// Ignore the certificate
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

export const scrapPlp = (timeout = 60) => {
  const categories = [
    "sporting",
    "fashion",
    "electronics",
    "computers",
    "videogames",
    "home",
  ];

  setInterval(async () => {
    const pages = Array.from(
      { length: 5 },
      () => Math.floor(Math.random() * 399) + 2
    );

    for (const category of categories) {
      await Promise.all(
        new AmazonPlpScraper(category, [1, ...pages]).execute()
      );
    }
  }, timeout * 1000);
};

export const scrapPdp = async () => {
  const apiService = ApiService.getInstance();
  const ads = await apiService.get<AmazonAd[]>("amazon/ads/scrap");
  const countries = await apiService.get<Country[]>("countries");

  const promises = ads.map((ad) => {
    return new AmazonPdpScraper(ad, countries).execute();
  });

  await Promise.all(promises);
  scrapPdp();
};

program
  .command("plp")
  .option("-t, --timeout <timeout>")
  .action((options) => {
    scrapPlp(options.timeout);
  });

program.command("pdp").action(() => {
  scrapPdp();
});

program.parse(process.argv);
