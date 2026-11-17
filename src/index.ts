import axios from "axios";
import { createScraper } from "@/marketplaces";

createScraper().then((scraper) => scraper.execute());

process.on("uncaughtException", (e, o) => {
  console.log("uncaught exception", axios.isAxiosError(e) ? e.message : e, o);
});

process.on("unhandledRejection", (e, o) => {
  console.log("uncaught rejection", axios.isAxiosError(e) ? e.message : e, o);
});
