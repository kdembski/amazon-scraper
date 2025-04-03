import { ArgsService } from "@/services/ArgsService";
import { ProxyService } from "@/services/ProxyService";
import {
  PlaywrightActiveItem,
  PlaywrightItem,
  PlaywrightQueueItem,
} from "@/types/playwright.types";
import { Page, Response } from "playwright";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import UserAgent from "user-agents";

export class PlaywrightService {
  private baseUrl = "https://www.amazon.";
  private static instance: PlaywrightService;
  private proxyService;
  private limit;
  private queue: PlaywrightQueueItem[] = [];
  private active: PlaywrightActiveItem[] = [];
  private id = 0;
  completed = 0;
  failed = 0;
  captcha = 0;

  private constructor(
    proxyService = ProxyService.getInstance(),
    argsService = ArgsService.getInstance()
  ) {
    this.proxyService = proxyService;
    this.limit = argsService.getLimitFlag();
    chromium.use(stealth());

    this.startQueue();

    setInterval(() => {
      const sum = this.active.length + this.queue.length + this.completed;
      const text = ` active: ${this.active.length} | queue: ${this.queue.length} | completed: ${this.completed} | sum: ${sum} | captcha: ${this.captcha} | failed: ${this.failed}`;
      console.log(text);
    }, 1000);
  }

  public static getInstance(): PlaywrightService {
    if (!PlaywrightService.instance) {
      PlaywrightService.instance = new PlaywrightService();
    }

    return PlaywrightService.instance;
  }

  create(url: string, referer: string) {
    return new Promise<PlaywrightItem>((resolve, reject) => {
      this.queue.push({ id: this.id, url, referer, resolve, reject });
      this.id++;
    });
  }

  private startQueue() {
    const delay = 100;

    setTimeout(() => {
      this.next();
      this.startQueue();
    }, delay);
  }

  private async next() {
    if (this.active.length >= this.limit) return;

    const next = this.queue.shift();
    if (!next) return;

    const item = this.buildItem(next);
    this.active.push({ id: next.id, item });
  }

  private async remove(id: number) {
    this.active = this.active.filter((item) => item.id !== id);
  }

  private async buildItem({
    id,
    url,
    referer,
    resolve,
    reject,
  }: PlaywrightQueueItem) {
    const userAgent = new UserAgent().toString();
    const proxy = this.proxyService.getRandomProxy();

    const config = {
      proxy: {
        server: proxy,
      },
      extraHTTPHeaders: {
        referer: `${this.baseUrl}${referer}`,
      },
      viewport: null,
      userAgent,
    };

    const browser = await chromium.launch({
      headless: true,
      channel: "chrome",
      args: ["--disable-blink-features=AutomationControlled"],
    });
    const context = await browser.newContext(config);
    const page = await context.newPage();

    context.setDefaultTimeout(1 * 30 * 1000);
    let response: Response | null = null;

    const close = async () => {
      this.remove(id);
      if (!page.isClosed()) {
        await page.close();
        await context.close();
        await browser.close();
      }
    };

    const isSuccess = () => {
      return !!response && response.status() === 200;
    };

    const is404 = () => {
      return !!response && response.status() === 404;
    };

    const isError = () => {
      return !!response && response.status() === 404;
    };

    const isCaptcha = () => {
      return page.isVisible(`form[action="/errors/validateCaptcha"]`);
    };

    const item = {
      browser,
      context,
      page,
      response,
      close,
      isSuccess,
      isError,
      is404,
      isCaptcha,
    };

    await this.abortUselessRequest(page);

    await page
      .goto(`${this.baseUrl}${url}`, {
        waitUntil: "commit",
        timeout: 2 * 60 * 1000,
      })
      .then((r) => {
        response = r;
        resolve(item);
      })
      .catch((e) => {
        reject(e);
        close();
      });

    return item;
  }

  private abortUselessRequest(page: Page) {
    const typesToBlock = ["image", "media", "font", "stylesheet"];
    return page.route("**/*", (route, request) => {
      if (typesToBlock.includes(request.resourceType())) {
        route.abort();
        return;
      }

      route.continue();
    });
  }
}
