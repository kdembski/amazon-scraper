import { sleep } from "@/shared/utils/sleep";

// Default failed attempts after which a unit of work is given up
export const MAX_FAILED_ATTEMPTS = 6;

const BASE_DELAY = 1000;
const MAX_DELAY = 60 * 1000;

export class RetryBackoff {
  failed = 0;

  constructor(
    private maxFailed = MAX_FAILED_ATTEMPTS,
    private random = Math.random
  ) {}

  fail() {
    this.failed++;
  }

  get isExhausted() {
    return this.failed >= this.maxFailed;
  }

  // Exponential backoff with jitter: 1s, 2s, 4s ... capped at 60s, randomized to 50-100%
  get delay() {
    const exponent = Math.max(this.failed - 1, 0);
    const delay = Math.min(BASE_DELAY * 2 ** exponent, MAX_DELAY);
    return Math.round(delay * (0.5 + this.random() / 2));
  }

  wait() {
    return sleep(this.delay);
  }
}
