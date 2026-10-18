import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyList } from "@/shared/http/proxy/ProxyList";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

const get = vi.mocked(axios.get);
const RETRY_DELAY = 2 * 60 * 1000;

const list = (...lines: string[]) => ({ data: lines.join("\n") });

describe("ProxyList", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("PROXY_LIST_TOKEN", "token");
    get.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("downloads the webshare list with the token", async () => {
    get.mockResolvedValue(list("1.1.1.1:8080:user:pass"));

    await new ProxyList().load();

    expect(get).toHaveBeenCalledWith(
      "https://proxy.webshare.io/api/v2/proxy/list/download/token/-/any/username/direct/-/"
    );
  });

  it("downloads the list from PROXY_LIST_URL when it is set", async () => {
    vi.stubEnv("PROXY_LIST_URL", "http://127.0.0.1:9000/proxies");
    get.mockResolvedValue(list("1.1.1.1:8080:user:pass"));

    await new ProxyList().load();

    expect(get).toHaveBeenCalledWith("http://127.0.0.1:9000/proxies");
  });

  it.each([
    ["\\n", "1.1.1.1:8080:u1:p1\n2.2.2.2:8081:u2:p2\n"],
    ["\\r\\n", "1.1.1.1:8080:u1:p1\r\n2.2.2.2:8081:u2:p2\r\n"],
  ])("turns lines separated by %s into proxy urls", async (_name, data) => {
    get.mockResolvedValue({ data });

    expect(await new ProxyList().load()).toEqual([
      "http://u1:p1@1.1.1.1:8080",
      "http://u2:p2@2.2.2.2:8081",
    ]);
  });

  it("retries every 2 minutes until the list is downloaded", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    get
      .mockRejectedValueOnce(new Error("down"))
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(list("1.1.1.1:8080:user:pass"));
    const done = vi.fn();
    new ProxyList().load().then(done);

    await vi.advanceTimersByTimeAsync(RETRY_DELAY);
    expect(get).toHaveBeenCalledTimes(2);
    expect(done).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(RETRY_DELAY);
    expect(get).toHaveBeenCalledTimes(3);
    expect(done).toHaveBeenCalledWith(["http://user:pass@1.1.1.1:8080"]);
  });
});
