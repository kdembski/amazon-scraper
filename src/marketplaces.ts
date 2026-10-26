import { AmazonPdpScraper } from "@/marketplaces/amazon/pdp/AmazonPdpScraper";
import { AmazonPlpScraper } from "@/marketplaces/amazon/plp/AmazonPlpScraper";
import { ArgsService, Target } from "@/shared/args/ArgsService";
import { MetricsReporter } from "@/shared/backend/MetricsReporter";
import { ScraperConfigService } from "@/shared/backend/ScraperConfigService";
import { ProxyService } from "@/shared/http/proxy/ProxyService";
import { MarketplaceScraper } from "@/shared/interfaces/MarketplaceScraper";

const scrapers: Record<Target, () => MarketplaceScraper> = {
  pdp: () => new AmazonPdpScraper(),
  plp: () => new AmazonPlpScraper(),
};

export async function createScraper(): Promise<MarketplaceScraper> {
  const target = ArgsService.getInstance().getTargetFlag();

  const configService = ScraperConfigService.getInstance();
  await configService.load();
  configService.start();

  const scraper = scrapers[target]();
  MetricsReporter.getInstance().start(scraper.marketplace);
  await ProxyService.getInstance().loadProxies();
  return scraper;
}
