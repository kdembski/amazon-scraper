import { configDotenv } from "dotenv";
import { AmazonPageScraper } from "./AmazonPageScraper";

configDotenv();
// Ignore the certificate
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

const run = async () => {
  const scraper = new AmazonPageScraper();
  scraper.scrapMultiplePlps("computers", 400);
};

run();
