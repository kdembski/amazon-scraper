import type { Route } from "@/shared/http/http.types";

const BLOCK_TIME = 60 * 1000;
const WINDOW = 60 * 1000;
const MIN_RESPONSES = 100;
const BLOCKED_SHARE = 0.2;

type Responses = { all: number[]; blocked: number[] };

export class DirectBlockList {
  // "<route> <host>" pairs blocked by the host, until the given time
  private blocked = new Map<string, number>();
  // Times of the responses within WINDOW per pair: all and the blocked ones (403 / 429)
  private responses = new Map<string, Responses>();

  // Counts a response; blocks the pair for BLOCK_TIME and returns true once at
  // least MIN_RESPONSES came within WINDOW and BLOCKED_SHARE of them were blocked
  record(route: Route, host: string, blocked: boolean) {
    const key = `${route} ${host}`;
    const now = Date.now();
    const responses = this.responses.get(key) ?? { all: [], blocked: [] };
    responses.all.push(now);
    if (blocked) responses.blocked.push(now);
    this.drop(responses, now - WINDOW);
    this.responses.set(key, responses);

    const { all } = responses;
    if (all.length < MIN_RESPONSES || responses.blocked.length < all.length * BLOCKED_SHARE) return false;

    this.responses.delete(key);
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

  private drop({ all, blocked }: Responses, before: number) {
    while (all.length && all[0] <= before) all.shift();
    while (blocked.length && blocked[0] <= before) blocked.shift();
  }
}
