import { AmazonAodAdBuilder } from "@/builders/AmazonAodAdBuilder";
import { AmazonPdpAdBuilder } from "@/builders/AmazonPdpAdBuilder";
import { AmazonService } from "@/services/AmazonService";
import { ArgsService } from "@/services/ArgsService";
import { parseHTML } from "linkedom";
import { writeFileSync } from "node:fs";
import { configDotenv } from "dotenv";
import { ProxyService } from "@/services/ProxyService";
import { AmazonAdBuilder, Country } from "@/types/amazon.types";

configDotenv();

const testAsin = async () => {
  await ProxyService.getInstance().loadProxies();
  const asin = process.argv[2];
  const service = AmazonService.getInstance();
  const { isAod } = ArgsService.getInstance().getSourceFlag();
  const builder: AmazonAdBuilder = isAod
    ? new AmazonAodAdBuilder()
    : new AmazonPdpAdBuilder();
  const source = isAod ? "aod" : "pdp";
  const countries = ["de", "fr", "it", "pl", "se"];

  countries.forEach(async (code) => {
    const country = { code } as Country;
    const { url, referer } = builder.buildUrl(country, { id: 0, asin });

    service.get<string>(url, referer, {
      onSuccess: (data) => {
        writeFileSync(`test-html/${asin}-${code}-${source}.html`, data);
        const { document } = parseHTML(data);
        console.log(code, builder.build(document));
      },
      onError: (e) => {
        console.log(code, e.message);
      },
    });
  });
};

testAsin();
