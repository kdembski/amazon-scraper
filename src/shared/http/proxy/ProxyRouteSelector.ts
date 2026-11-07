import type { ProxyAgentPool } from "@/shared/http/proxy/ProxyAgentPool";

export class ProxyRouteSelector {
  directFamilies: (4 | 6)[] = [4];
  private nextDirect = 0;

  constructor(private pool: ProxyAgentPool) {}

  // Direct agent when the proxy type asks for one now and the host blocks not
  // every IP family: "direct" over the server's IPv4 and IPv6 in turn,
  // "mixedN/M" the same for N minutes out of N + M (M = N when left out)
  getDirect(host: string, proxyType: string) {
    if (proxyType !== "direct" && !this.isDirectWindow(proxyType)) return;

    const families = this.directFamilies.filter(
      (family) => !this.pool.isDirectBlocked(family, host)
    );
    if (!families.length) return;

    return this.pool.getDirect(families[this.nextDirect++ % families.length]);
  }

  private isDirectWindow(proxyType: string) {
    const mixed = proxyType.match(/^mixed(\d+)(?:\/(\d+))?$/);
    const direct = Number(mixed?.[1]);
    if (!direct) return false;

    const proxy = Number(mixed?.[2] ?? direct);
    const minute = Math.floor(Date.now() / (60 * 1000));

    return minute % (direct + proxy) < direct;
  }
}
