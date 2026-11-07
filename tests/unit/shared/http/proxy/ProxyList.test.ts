import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyList } from "@/shared/http/proxy/ProxyList";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

const get = vi.mocked(axios.get);
const RETRY_DELAY = 2 * 60 * 1000;
const PLANS_URL = "https://proxy.webshare.io/api/v2/subscription/plan/";
const CONFIG_URL = "https://proxy.webshare.io/api/v2/proxy/config/";
const listUrl = (planId: number, token = "token-key") =>
  `https://proxy.webshare.io/api/v2/proxy/list/download/${token}/-/any/username/direct/-/?plan_id=${planId}`;

const list = (...lines: string[]) => ({ data: lines.join("\n") });
const plan = (id: number, proxy_subtype: string, status = "active") => ({
  id,
  status,
  proxy_subtype,
});

const auth = (key: string) => ({ headers: { Authorization: `Token ${key}` } });
const keyOf = (config: unknown) =>
  (config as ReturnType<typeof auth>).headers.Authorization.replace("Token ", "");

const respond = (plans: object[] | Record<string, object[]>, lists: Record<number, object>) =>
  get.mockImplementation(async (url: string, config?: unknown) => {
    if (url === CONFIG_URL) return { data: { proxy_list_download_token: `token-${keyOf(config)}` } };
    if (url === PLANS_URL) {
      return { data: { results: Array.isArray(plans) ? plans : plans[keyOf(config)] } };
    }
    const planId = Number(new URL(url).searchParams.get("plan_id"));
    return lists[planId];
  });

describe("ProxyList", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("PROXY_API_KEY", "key");
    vi.stubEnv("PROXY_API_KEY2", "");
    vi.stubEnv("PROXY_LIST_URL", "");
    get.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads the webshare plans with the api key", async () => {
    respond([], {});

    await new ProxyList().load();

    expect(get).toHaveBeenCalledWith(PLANS_URL, auth("key"));
  });

  it("downloads the plans of the second api key with its own list token", async () => {
    vi.stubEnv("PROXY_API_KEY2", "key2");
    respond({ key: [plan(1, "default")], key2: [plan(2, "default")] }, {
      1: list("1.1.1.1:8080:u1:p1"),
      2: list("2.2.2.2:8081:u2:p2"),
    });

    expect(await new ProxyList().load()).toEqual({
      datacenter: ["http://u1:p1@1.1.1.1:8080", "http://u2:p2@2.2.2.2:8081"],
    });
    expect(get).toHaveBeenCalledWith(CONFIG_URL, auth("key2"));
    expect(get).toHaveBeenCalledWith(listUrl(2, "token-key2"));
  });

  it("downloads the list of every active plan with the key's token into a pool named after its subtype", async () => {
    respond([plan(1, "default"), plan(2, "isp"), plan(3, "default", "cancelled")], {
      1: list("1.1.1.1:8080:u1:p1"),
      2: list("2.2.2.2:8081:u2:p2"),
    });

    expect(await new ProxyList().load()).toEqual({
      datacenter: ["http://u1:p1@1.1.1.1:8080"],
      isp: ["http://u2:p2@2.2.2.2:8081"],
    });
    expect(get).toHaveBeenCalledWith(listUrl(1));
    expect(get).toHaveBeenCalledWith(listUrl(2));
    expect(get).not.toHaveBeenCalledWith(listUrl(3));
  });

  it("joins the lists of plans with the same subtype", async () => {
    respond([plan(1, "isp"), plan(2, "isp")], {
      1: list("1.1.1.1:8080:u1:p1"),
      2: list("2.2.2.2:8081:u2:p2"),
    });

    expect(await new ProxyList().load()).toEqual({
      isp: ["http://u1:p1@1.1.1.1:8080", "http://u2:p2@2.2.2.2:8081"],
    });
  });

  it("downloads only PROXY_LIST_URL as the datacenter pool when it is set", async () => {
    vi.stubEnv("PROXY_LIST_URL", "http://127.0.0.1:9000/proxies");
    get.mockResolvedValue(list("1.1.1.1:8080:user:pass"));

    expect(await new ProxyList().load()).toEqual({
      datacenter: ["http://user:pass@1.1.1.1:8080"],
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("http://127.0.0.1:9000/proxies");
  });

  it.each([
    ["\\n", "1.1.1.1:8080:u1:p1\n2.2.2.2:8081:u2:p2\n"],
    ["\\r\\n", "1.1.1.1:8080:u1:p1\r\n2.2.2.2:8081:u2:p2\r\n"],
  ])("turns lines separated by %s into proxy urls", async (_name, data) => {
    respond([plan(1, "default")], { 1: { data } });

    expect(await new ProxyList().load()).toEqual({
      datacenter: ["http://u1:p1@1.1.1.1:8080", "http://u2:p2@2.2.2.2:8081"],
    });
  });

  it("retries every 2 minutes until the token, plans and lists are downloaded", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const config = { data: { proxy_list_download_token: "token" } };
    get
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce({ data: { results: [plan(1, "default")] } })
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce({ data: { results: [plan(1, "default")] } })
      .mockResolvedValueOnce(list("1.1.1.1:8080:user:pass"));
    const done = vi.fn();
    new ProxyList().load().then(done);

    await vi.advanceTimersByTimeAsync(RETRY_DELAY);
    expect(get).toHaveBeenCalledTimes(4);
    expect(done).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(RETRY_DELAY);
    expect(get).toHaveBeenCalledTimes(7);
    expect(done).toHaveBeenCalledWith({ datacenter: ["http://user:pass@1.1.1.1:8080"] });
  });

  it("skips empty lines and reads windows line endings", async () => {
    respond([plan(1, "default")], {
      1: { data: "1.1.1.1:8080:u1:p1\r\n\r\n2.2.2.2:8081:u2:p2\n" },
    });

    await expect(new ProxyList().load()).resolves.toEqual({
      datacenter: ["http://u1:p1@1.1.1.1:8080", "http://u2:p2@2.2.2.2:8081"],
    });
  });
});
