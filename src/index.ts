import { AmazonScraper } from "@/scrapers/AmazonScraper";
import { configDotenv } from "dotenv";

configDotenv();
// Ignore the certificate
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

new AmazonScraper().execute();
