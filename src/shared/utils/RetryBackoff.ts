import { sleep } from "@/shared/utils/sleep";

// Failed attempts after which a country / listing page is given up
export const MAX_FAILED_ATTEMPTS = 6;

const BASE_DELAY = 1000;
const MAX_DELAY = 60 * 1000;

export class RetryBackoff {
  failed = 0;

  constructor(private random = Math.random) {}

  fail() {
    this.failed++;
  }

  get isExhausted() {
    return this.failed >= MAX_FAILED_ATTEMPTS;
  }

  // Exponential backoff with jitter: 1s, 2s, 4s ... capped at 60s, each
  // randomized to 50-100% so retries of one batch do not fire together
  get delay() {
    const exponent = Math.max(this.failed - 1, 0);
    const delay = Math.min(BASE_DELAY * 2 ** exponent, MAX_DELAY);
    return Math.round(delay * (0.5 + this.random() / 2));
  }

  wait() {
    return sleep(this.delay);
  }
}
