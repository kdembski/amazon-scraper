import { ApiService } from "@/shared/backend/ApiService";
import { Country } from "@/shared/types/Country";
import { CronJob } from "cron";

export class CountryService {
  private static instance: CountryService;
  private apiService;
  private countries: Country[] = [];

  private constructor(apiService = ApiService.getInstance()) {
    this.apiService = apiService;
    new CronJob("0 0 */1 * * *", () => this.loadCountries()).start();
  }

  public static getInstance(): CountryService {
    if (!CountryService.instance) {
      CountryService.instance = new CountryService();
    }

    return CountryService.instance;
  }

  async getCountries() {
    if (!this.countries.length) {
      await this.loadCountries();
    }

    return this.countries;
  }

  async loadCountries() {
    this.countries = await this.apiService.get<Country[]>("countries");
  }
}
