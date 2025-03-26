import { Browser, BrowserContext, Page, Response } from "playwright";

export interface PlaywrightItem {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  response: Response | null;
  close: () => Promise<void>;
  isSuccess: () => boolean;
  isError: () => boolean;
  is404: () => boolean;
  isCaptcha: () => Promise<boolean>;
}

export interface PlaywrightQueueItem {
  id: number;
  url: string;
  referer: string;
  resolve: (item: PlaywrightItem) => void;
  reject: (e: any) => void;
}

export interface PlaywrightActiveItem {
  id: number;
  item: Promise<PlaywrightItem> | PlaywrightItem;
}
