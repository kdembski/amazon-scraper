import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArgsService } from "@/shared/args/ArgsService";

describe("ArgsService", () => {
  const originalArgv = process.argv;
  const args = ArgsService.getInstance();

  const setArgs = (...flags: string[]) => {
    process.argv = ["node", "index.ts", ...flags];
  };

  beforeEach(() => setArgs());
  afterEach(() => {
    process.argv = originalArgv;
  });

  it("is a singleton", () => {
    expect(ArgsService.getInstance()).toBe(args);
  });

  describe("getFlagValue", () => {
    it("returns the value following the flag", () => {
      setArgs("-x", "foo");
      expect(args.getFlagValue("-x")).toBe("foo");
    });

    it("returns undefined for a missing flag", () => {
      expect(args.getFlagValue("-x")).toBeUndefined();
    });
  });

  describe("getTargetFlag", () => {
    it("defaults to pdp", () => {
      expect(args.getTargetFlag()).toBe("pdp");
    });

    it.each([["-t"], ["--target"]])("reads plp from %s", (flag) => {
      setArgs(flag, "plp");
      expect(args.getTargetFlag()).toBe("plp");
    });

    it("reads explicit pdp", () => {
      setArgs("-t", "pdp");
      expect(args.getTargetFlag()).toBe("pdp");
    });

    it("throws on an unknown target", () => {
      setArgs("-t", "foo");
      expect(() => args.getTargetFlag()).toThrow("Unknown target: foo");
    });
  });

  describe("getScraperName", () => {
    // The constructor is private, it is only called through getInstance()
    const Service = ArgsService as unknown as new (...deps: unknown[]) => ArgsService;
    const eth0 = { eth0: [{ family: "IPv4", address: "172.19.0.2" }] };

    const setup = (hosts: string[] | Error = [], interfaces: object = eth0) => {
      const resolvePtr = vi.fn(async () => {
        if (hosts instanceof Error) throw hosts;
        return hosts;
      });
      return { service: new Service({ resolvePtr }, () => interfaces), resolvePtr };
    };

    beforeEach(() => {
      vi.stubEnv("name", "amazon-pdp");
      vi.stubEnv("NAME_PREFIX", "");
    });

    it("appends the replica number from the container name", async () => {
      const { service, resolvePtr } = setup(["amazon-scraper-amazon-pdp-2.amazon-scraper_default"]);
      expect(await service.getScraperName()).toBe("amazon-pdp-2");
      expect(resolvePtr).toHaveBeenCalledWith("2.0.19.172.in-addr.arpa");
    });

    it("prefixes the name with NAME_PREFIX", async () => {
      vi.stubEnv("NAME_PREFIX", "home");
      const { service } = setup(["amazon-scraper-amazon-pdp-2.amazon-scraper_default"]);
      expect(await service.getScraperName()).toBe("home-amazon-pdp-2");
    });

    it("resolves the name once", async () => {
      const { service, resolvePtr } = setup(["amazon-scraper-amazon-pdp-2.amazon-scraper_default"]);
      await service.getScraperName();
      await service.getScraperName();
      expect(resolvePtr).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["a host that is not a replica of the service", ["router-1.lan"]],
      ["no PTR record", []],
      ["a failed lookup", new Error("ENOTFOUND")],
    ])("keeps name for %s", async (_label, hosts) => {
      const { service } = setup(hosts);
      expect(await service.getScraperName()).toBe("amazon-pdp");
    });

    it("keeps name without eth0", async () => {
      const { service, resolvePtr } = setup([], {});
      expect(await service.getScraperName()).toBe("amazon-pdp");
      expect(resolvePtr).not.toHaveBeenCalled();
    });
  });
});
