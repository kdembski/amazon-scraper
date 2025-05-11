import { AmazonPdpAdBuilder } from "@/builders/AmazonPdpAdBuilder";
import { AmazonService } from "@/services/AmazonService";
import { parseHTML } from "linkedom";
import { writeFileSync } from "node:fs";
import { configDotenv } from "dotenv";
import { ProxyService } from "@/services/ProxyService";

configDotenv();

const testAsin = async () => {
  await ProxyService.getInstance().loadProxies();
  const asin = process.argv[2];
  const service = AmazonService.getInstance();
  const countries = ["de", "fr", "it", "pl", "se"];

  countries.forEach(async (country) => {
    const url = `${country}/dp/${asin}`;

    service.get<string>(url, undefined, {
      onSuccess: (data) => {
        writeFileSync(`test-html/${asin}-${country}.html`, data);
        const { document } = parseHTML(data);
        const ad = new AmazonPdpAdBuilder().build(document);
        console.log(ad);
      },
      onError: (e) => {
        console.log(e.message);
      },
    });
  });
};

testAsin();
