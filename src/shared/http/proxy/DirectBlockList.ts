import type { Route } from "@/shared/http/http.types";

const BLOCK_TIME = 3 * 60 * 1000;
const HIT_WINDOW = 60 * 1000;
const HITS_TO_BLOCK = 5;

export class DirectBlockList {
  // "<route> <host>" pairs blocked by the host, until the given time
  private blocked = new Map<string, number>();
  // Times of the recent block signals (403 / 429) per pair
  private hits = new Map<string, number[]>();

  // Counts a block signal; the HITS_TO_BLOCK-th within HIT_WINDOW blocks the
  // pair for BLOCK_TIME and returns true
  hit(route: Route, host: string) {
    const key = `${route} ${host}`;
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => at > now - HIT_WINDOW);
    recent.push(now);
    if (recent.length < HITS_TO_BLOCK) {
      this.hits.set(key, recent);
      return false;
    }

    this.hits.delete(key);
    this.blocked.set(key, now + BLOCK_TIME);
    return true;
  }

  isBlocked(route: Route, host: string) {
    const key = `${route} ${host}`;
    const until = this.blocked.get(key);
    if (!until) return false;
    if (until > Date.now()) return true;

    this.blocked.delete(key);
    return false;
  }
}
