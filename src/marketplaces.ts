import { AmazonScraper } from "@/marketplaces/amazon/AmazonScraper";
import { MetricsReporter } from "@/shared/backend/MetricsReporter";
import { MarketplaceScraper } from "@/shared/interfaces/MarketplaceScraper";

export function createScraper(): MarketplaceScraper {
  const scraper = new AmazonScraper();
  MetricsReporter.getInstance().start(scraper.marketplace);
  return scraper;
}
