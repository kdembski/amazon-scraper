import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyList } from "@/shared/http/proxy/ProxyList";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

const get = vi.mocked(axios.get);
const RETRY_DELAY = 2 * 60 * 1000;
const PLANS_URL = "https://proxy.webshare.io/api/v2/subscription/plan/";
const CONFIG_URL = "https://proxy.webshare.io/api/v2/proxy/config/";
const SUBSCRIPTION_URL = "https://proxy.webshare.io/api/v2/subscription/";
const STATS_URL = "https://proxy.webshare.io/api/v2/stats/aggregate/";
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-10T00:00:00Z");
const PERIOD = { start_date: "2026-11-02T00:00:00Z", end_date: "2026-12-02T00:00:00Z" };
const listUrl = (planId: number, token = "token-key") =>
  `https://proxy.webshare.io/api/v2/proxy/list/download/${token}/-/any/username/direct/-/?plan_id=${planId}`;

const list = (...lines: string[]) => ({ data: lines.join("\n") });
const plan = (id: number, proxy_subtype: string, status = "active", bandwidth_limit = 1000) => ({
  id,
  status,
  proxy_subtype,
  bandwidth_limit,
});

const auth = (key: string) => ({ headers: { Authorization: `Token ${key}` } });
const keyOf = (config: unknown) =>
  (config as ReturnType<typeof auth>).headers.Authorization.replace("Token ", "");

const respond = (
  plans: object[] | Record<string, object[]>,
  lists: Record<number, object>,
  used: Record<number, number> = {}
) =>
  get.mockImplementation(async (url: string, config?: unknown) => {
    if (url === CONFIG_URL) return { data: { proxy_list_download_token: `token-${keyOf(config)}` } };
    if (url === SUBSCRIPTION_URL) return { data: PERIOD };
    if (url === STATS_URL) {
      const planId = (config as { params: { plan_id: number } }).params.plan_id;
      if (used[planId] === undefined) throw new Error("stats down");
      return { data: { bandwidth_total: used[planId] } };
    }
    if (url === PLANS_URL) {
      return { data: { results: Array.isArray(plans) ? plans : plans[keyOf(config)] } };
    }
    const planId = Number(new URL(url).searchParams.get("plan_id"));
    return lists[planId];
  });

describe("ProxyList", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
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

  it("downloads the plans of the second api key with its own list token", async () => {
    vi.stubEnv("PROXY_API_KEY2", "key2");
    respond({ key: [plan(1, "default")], key2: [plan(2, "default")] }, {
      1: list("1.1.1.1:8080:u1:p1"),
      2: list("2.2.2.2:8081:u2:p2"),
    });

    expect(await new ProxyList().load()).toEqual([
      { urls: ["http://u1:p1@1.1.1.1:8080"], weight: expect.any(Number) },
      { urls: ["http://u2:p2@2.2.2.2:8081"], weight: expect.any(Number) },
    ]);
    expect(get).toHaveBeenCalledWith(CONFIG_URL, auth("key2"));
    expect(get).toHaveBeenCalledWith(SUBSCRIPTION_URL, auth("key2"));
    expect(get).toHaveBeenCalledWith(listUrl(2, "token-key2"));
  });

  it("downloads the list of every active datacenter plan only", async () => {
    respond([plan(1, "default"), plan(2, "isp"), plan(3, "default", "cancelled")], {
      1: list("1.1.1.1:8080:u1:p1"),
      2: list("2.2.2.2:8081:u2:p2"),
    });

    expect(await new ProxyList().load()).toEqual([
      { urls: ["http://u1:p1@1.1.1.1:8080"], weight: expect.any(Number) },
    ]);
    expect(get).toHaveBeenCalledWith(listUrl(1));
    expect(get).not.toHaveBeenCalledWith(listUrl(2));
    expect(get).not.toHaveBeenCalledWith(listUrl(3));
  });

  it("weighs a plan by the bandwidth left per ms until the period ends", async () => {
    respond([plan(1, "default", "active", 5000), plan(2, "default", "active", 100)], {
      1: list("1.1.1.1:8080:u1:p1"),
      2: list("2.2.2.2:8081:u2:p2"),
    }, { 1: 1400e9, 2: 150e9 });

    const [first, second] = await new ProxyList().load();

    expect(first.weight).toBeCloseTo(3600e9 / (22 * DAY));
    expect(second.weight).toBe(0);
    expect(get).toHaveBeenCalledWith(STATS_URL, {
      ...auth("key"),
      params: { plan_id: 1, timestamp__gte: PERIOD.start_date, timestamp__lte: PERIOD.end_date },
    });
  });

  it("counts at least an hour left at the end of the period", async () => {
    vi.setSystemTime(Date.parse(PERIOD.end_date) - 60 * 1000);
    respond([plan(1, "default", "active", 10)], { 1: list("1.1.1.1:8080:u1:p1") }, { 1: 4e9 });

    const [first] = await new ProxyList().load();

    expect(first.weight).toBeCloseTo(6e9 / (60 * 60 * 1000));
  });

  it("treats the bandwidth of a plan as unused when its stats fail", async () => {
    respond([plan(1, "default", "active", 10)], { 1: list("1.1.1.1:8080:u1:p1") });

    const [first] = await new ProxyList().load();

    expect(first.weight).toBeCloseTo(10e9 / (22 * DAY));
  });

  it("downloads only PROXY_LIST_URL as one plan when it is set", async () => {
    vi.stubEnv("PROXY_LIST_URL", "http://127.0.0.1:9000/proxies");
    get.mockResolvedValue(list("1.1.1.1:8080:user:pass"));

    expect(await new ProxyList().load()).toEqual([
      { urls: ["http://user:pass@1.1.1.1:8080"], weight: 1 },
    ]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("http://127.0.0.1:9000/proxies");
  });

  it.each([
    ["\n", "1.1.1.1:8080:u1:p1\n2.2.2.2:8081:u2:p2\n"],
    ["\r\n", "1.1.1.1:8080:u1:p1\r\n2.2.2.2:8081:u2:p2\r\n"],
  ])("turns lines separated by %s into proxy urls", async (_name, data) => {
    respond([plan(1, "default")], { 1: { data } });

    const [first] = await new ProxyList().load();

    expect(first.urls).toEqual(["http://u1:p1@1.1.1.1:8080", "http://u2:p2@2.2.2.2:8081"]);
  });

  it("retries every 2 minutes until the token, period, plans and lists are downloaded", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const config = { data: { proxy_list_download_token: "token" } };
    const period = { data: PERIOD };
    const plans = { data: { results: [plan(1, "default")] } };
    get
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce(period)
      .mockResolvedValueOnce(plans)
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce(period)
      .mockResolvedValueOnce(plans)
      .mockResolvedValueOnce(list("1.1.1.1:8080:user:pass"))
      .mockResolvedValueOnce({ data: { bandwidth_total: 0 } });
    const done = vi.fn();
    new ProxyList().load().then(done);

    await vi.advanceTimersByTimeAsync(RETRY_DELAY);
    expect(get).toHaveBeenCalledTimes(5);
    expect(done).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(RETRY_DELAY);
    expect(get).toHaveBeenCalledTimes(10);
    expect(done).toHaveBeenCalledWith([
      { urls: ["http://user:pass@1.1.1.1:8080"], weight: expect.any(Number) },
    ]);
  });

  it("skips empty lines and reads windows line endings", async () => {
    respond([plan(1, "default")], {
      1: { data: "1.1.1.1:8080:u1:p1\r\n\r\n2.2.2.2:8081:u2:p2\n" },
    });

    const [first] = await new ProxyList().load();

    expect(first.urls).toEqual(["http://u1:p1@1.1.1.1:8080", "http://u2:p2@2.2.2.2:8081"]);
  });
});
