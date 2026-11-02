export class RateLimiter {
  private tokens;
  private lastRefill = Date.now();

  constructor(private rps: number) {
    this.tokens = rps;
  }

  take() {
    const now = Date.now();
    this.tokens = Math.min(this.rps, this.tokens + ((now - this.lastRefill) * this.rps) / 1000);
    this.lastRefill = now;
    if (this.tokens < 1) return false;

    this.tokens--;
    return true;
  }
}
