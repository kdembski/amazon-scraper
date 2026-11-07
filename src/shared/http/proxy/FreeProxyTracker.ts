export class FreeProxyTracker {
  // Per host, proxies in the order their idle connection was last freed
  private freed = new Map<string, Set<string>>();

  markFree(url: string, host: string) {
    const urls = this.freed.get(host) ?? new Set<string>();
    urls.delete(url);
    urls.add(url);
    this.freed.set(host, urls);
  }

  // Proxy with the most recently freed idle connection to the host, removed
  // from the order so the next caller gets another one
  takeLast(
    host: string,
    hasFreeSocket: (url: string) => boolean,
    accept: (url: string) => boolean
  ) {
    const urls = this.freed.get(host);
    if (!urls) return;

    for (const url of [...urls].reverse()) {
      if (!hasFreeSocket(url)) {
        urls.delete(url);
        continue;
      }
      if (!accept(url)) continue;

      urls.delete(url);
      return url;
    }
  }
}
