import { AmazonPdpAdBuilder } from "@/builders/AmazonPdpAdBuilder";
import { AmazonService } from "@/services/AmazonService";
import { parseHTML } from "linkedom";
import { writeFileSync } from "node:fs";
import { configDotenv } from "dotenv";

configDotenv();

const testAsin = () => {
  const asin = process.argv[2];
  const service = AmazonService.getInstance();
  const countries = ["de"];

  countries.forEach(async (country) => {
    const url = `https://www.amazon.${country}/dp/${asin}`;
    service.get<string>(url, undefined, {
      onSuccess: (data) => {
        //console.log(response.status);
        writeFileSync(`test-html/${asin}-${country}.html`, data);
        const { document } = parseHTML(data);
        const ad = new AmazonPdpAdBuilder().build(document);
      },
      onError: (e) => {
        console.log(e.message);
      },
    });
  });
};

setInterval(() => {
  testAsin();
}, 1000);
