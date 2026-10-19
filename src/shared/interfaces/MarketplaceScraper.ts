export interface MarketplaceScraper {
  readonly marketplace: string;
  execute(): Promise<void>;
}
