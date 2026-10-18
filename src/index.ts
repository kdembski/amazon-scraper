import { configDotenv } from "dotenv";
import { createScraper } from "@/marketplaces";

configDotenv();

// Ignore the certificate
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

createScraper().execute();

process.on("uncaughtException", (e, o) => {
  console.log("uncaught exception", e, o);
});

process.on("unhandledRejection", (e, o) => {
  console.log("uncaught rejection", e, o);
});
