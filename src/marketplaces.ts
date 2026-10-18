import { AmazonScraper } from "@/scrapers/AmazonScraper";
import { ScraperStatusService } from "@/shared/backend/ScraperStatusService";
import { MarketplaceScraper } from "@/shared/interfaces/MarketplaceScraper";

export function createScraper(): MarketplaceScraper {
  ScraperStatusService.getInstance();
  return new AmazonScraper();
}
