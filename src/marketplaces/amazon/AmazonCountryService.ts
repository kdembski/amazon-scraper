import { ApiService } from "@/shared/backend/ApiService";
import { AmazonCountry } from "@/marketplaces/amazon/types/amazon.types";
import { CronJob } from "cron";

export class AmazonCountryService {
  private static instance: AmazonCountryService;
  private countries: AmazonCountry[] = [];

  private constructor(private apiService = ApiService.getInstance()) {
    new CronJob("0 0 */1 * * *", () => this.loadCountries()).start();
  }

  public static getInstance(): AmazonCountryService {
    if (!AmazonCountryService.instance) {
      AmazonCountryService.instance = new AmazonCountryService();
    }

    return AmazonCountryService.instance;
  }

  async getCountries() {
    if (!this.countries.length) {
      await this.loadCountries();
    }

    return this.countries;
  }

  async loadCountries() {
    this.countries = await this.apiService.get<AmazonCountry[]>("amazon/countries/scrap");
  }
}
