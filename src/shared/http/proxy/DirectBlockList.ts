import type { Route } from "@/shared/http/http.types";

const BLOCK_TIME = 3 * 60 * 1000;

export class DirectBlockList {
  // "<route> <host>" pairs blocked by the host, until the given time
  private blocked = new Map<string, number>();

  block(route: Route, host: string) {
    this.blocked.set(`${route} ${host}`, Date.now() + BLOCK_TIME);
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
