import { beforeEach, describe, expect, it, vi } from "vitest";
import { CountryService } from "@/shared/backend/CountryService";
import { cronJobs } from "@@tests/support/cron";
import { fakeApiService } from "@@tests/support/fakes";
import { resetSingleton } from "@@tests/support/singleton";

vi.mock("cron", async () => (await import("@@tests/support/cron")).cronModule);

const countries = [{ id: 1, code: "de" }];

const setup = () => {
  const api = fakeApiService();
  // The constructor is private, it is only called through getInstance()
  const Service = CountryService as unknown as new (
    ...deps: unknown[]
  ) => CountryService;
  return { api, service: new Service(api.service) };
};

describe("CountryService", () => {
  beforeEach(() => {
    cronJobs.length = 0;
  });

  it("is a singleton", () => {
    resetSingleton(CountryService);
    expect(CountryService.getInstance()).toBe(CountryService.getInstance());
    resetSingleton(CountryService);
  });

  it("loads countries on first use", async () => {
    const { api, service } = setup();
    api.get.mockResolvedValue(countries);

    await expect(service.getCountries()).resolves.toEqual(countries);
    expect(api.get).toHaveBeenCalledWith("countries");
  });

  it("serves loaded countries from the cache", async () => {
    const { api, service } = setup();
    api.get.mockResolvedValue(countries);
    await service.loadCountries();

    await expect(service.getCountries()).resolves.toEqual(countries);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("reloads countries every hour", async () => {
    const { api } = setup();
    api.get.mockResolvedValue([]);

    expect(cronJobs).toHaveLength(1);
    expect(cronJobs[0].cronTime).toBe("0 0 */1 * * *");
    expect(cronJobs[0].start).toHaveBeenCalled();

    await cronJobs[0].onTick();
    expect(api.get).toHaveBeenCalledWith("countries");
  });
});
