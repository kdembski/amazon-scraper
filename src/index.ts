import { configDotenv } from "dotenv";
import { AmazonScraper } from "@/scrapers/AmazonScraper";

configDotenv();

// Ignore the certificate
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

new AmazonScraper().execute();

process.on("uncaughtException", (e, o) => {
  console.log("uncaught exception", e, o);
});

process.on("unhandledRejection", (e, o) => {
  console.log("uncaught rejection", e, o);
});
