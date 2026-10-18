import { AmazonScraper } from "@/marketplaces/amazon/AmazonScraper";
import { MetricsReporter } from "@/shared/backend/MetricsReporter";
import { ScraperStatusService } from "@/shared/backend/ScraperStatusService";
import { MarketplaceScraper } from "@/shared/interfaces/MarketplaceScraper";

export function createScraper(): MarketplaceScraper {
  ScraperStatusService.getInstance();
  const scraper = new AmazonScraper();
  MetricsReporter.getInstance().start(scraper.marketplace);
  return scraper;
}
