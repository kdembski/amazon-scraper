import { AmazonScraper } from "@/marketplaces/amazon/AmazonScraper";
import { MetricsReporter } from "@/shared/backend/MetricsReporter";
import { ScraperConfigService } from "@/shared/backend/ScraperConfigService";
import { MarketplaceScraper } from "@/shared/interfaces/MarketplaceScraper";

export async function createScraper(): Promise<MarketplaceScraper> {
  const configService = ScraperConfigService.getInstance();
  await configService.load();
  configService.start();

  const scraper = new AmazonScraper();
  MetricsReporter.getInstance().start(scraper.marketplace);
  return scraper;
}
