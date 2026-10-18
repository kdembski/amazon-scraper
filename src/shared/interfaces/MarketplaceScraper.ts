export interface MarketplaceScraper {
  execute(): Promise<void>;
}
