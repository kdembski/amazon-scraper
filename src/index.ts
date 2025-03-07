import { configDotenv } from "dotenv";
import { AmazonScraper } from "@/scrapers/AmazonScraper";

configDotenv();

// Ignore the certificate
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

new AmazonScraper().execute();
