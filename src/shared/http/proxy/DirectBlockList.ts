import type { DirectResponse, Route } from "@/shared/http/http.types";

const BLOCK_TIME = 60 * 1000;
const WINDOW = 60 * 1000;
const MIN_RESPONSES = 100;
const BLOCKED_SHARE = 0.2;

type Responses = { all: number[]; blocked: number[]; failed: number[] };

export class DirectBlockList {
  // "<route> <host>" pairs blocked by the host, until the given time
  private blocked = new Map<string, number>();
  // Times of the responses within WINDOW per pair: all, the blocked ones and the
  // failed ones (blocked or throttled)
  private responses = new Map<string, Responses>();

  // Counts a response; blocks the pair for BLOCK_TIME and returns true once at
  // least MIN_RESPONSES came within WINDOW and BLOCKED_SHARE of them were blocked
  // or all of them failed
  record(route: Route, host: string, response: DirectResponse) {
    const key = `${route} ${host}`;
    const now = Date.now();
    const responses = this.responses.get(key) ?? { all: [], blocked: [], failed: [] };
    responses.all.push(now);
    if (response === "blocked") responses.blocked.push(now);
    if (response !== "ok") responses.failed.push(now);
    this.drop(responses, now - WINDOW);
    this.responses.set(key, responses);

    const { all, blocked, failed } = responses;
    if (all.length < MIN_RESPONSES) return false;
    if (blocked.length < all.length * BLOCKED_SHARE && failed.length < all.length) return false;

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

  private drop(responses: Responses, before: number) {
    Object.values(responses).forEach((times) => {
      while (times.length && times[0] <= before) times.shift();
    });
  }
}
