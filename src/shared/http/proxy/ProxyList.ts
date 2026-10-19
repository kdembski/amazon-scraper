import axios from "axios";

export class ProxyList {
  private retryDelay = 2 * 60 * 1000;

  load() {
    return new Promise<string[]>((resolve) => this.download(resolve));
  }

  private download(resolve: (urls: string[]) => void) {
    // PROXY_LIST_URL points the list at another source (used by e2e tests)
    const url =
      process.env.PROXY_LIST_URL ||
      `https://proxy.webshare.io/api/v2/proxy/list/download/${process.env.PROXY_LIST_TOKEN}/-/any/username/direct/-/`;

    axios
      .get<string>(url)
      .then((response) => resolve(this.parse(response.data)))
      .catch((e) => {
        console.log("Proxy error: " + e);
        setTimeout(() => this.download(resolve), this.retryDelay);
      });
  }

  private parse(data: string) {
    const lines = data.includes("\r\n") ? data.split("\r\n") : data.split("\n");
    return lines.filter((line) => !!line).map((line) => this.toUrl(line));
  }

  private toUrl(proxy: string) {
    const parts = proxy.split(":");
    return `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
  }
}
