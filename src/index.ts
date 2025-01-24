import { configDotenv } from "dotenv";
import { program } from "commander";
import { AmazonPlpScraper } from "@/scrapers/AmazonPlpScraper";
import { AmazonPdpScraper } from "@/scrapers/AmazonPdpScraper";
import { ApiService } from "@/services/ApiService";
import { AmazonAd, Country } from "@/types/amazon.types";
import { AmazonService } from "@/services/AmazonService";

configDotenv();
// Ignore the certificate
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

export const scrapPlp = async () => {
  const categories = [
    "sporting",
    "fashion",
    "electronics",
    "computers",
    "videogames",
    "home",
  ];

  const pages = Array.from(
    { length: 5 },
    () => Math.floor(Math.random() * 399) + 2
  );

  const promises = categories.flatMap((category) =>
    new AmazonPlpScraper(category, pages).execute()
  );

  await Promise.all(promises);
  scrapPlp();
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
  .option("-l, --limit <limit>")
  .action((options) => {
    AmazonService.pendingLimit = options.limit;
    scrapPlp();
  });

program
  .command("pdp")
  .option("-l, --limit <limit>")
  .action((options) => {
    AmazonService.pendingLimit = options.limit;
    scrapPdp();
  });

program.parse(process.argv);
