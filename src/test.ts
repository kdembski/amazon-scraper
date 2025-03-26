import { AmazonPdpAdBuilder } from "@/builders/AmazonPdpAdBuilder";
import { AmazonService } from "@/services/AmazonService";
import { parseHTML } from "linkedom";
import { writeFileSync } from "node:fs";
import { configDotenv } from "dotenv";
import { PlaywrightService } from "@/services/PlaywrightService";

configDotenv();

const testAsin = () => {
  const asin = process.argv[2];
  const service = AmazonService.getInstance();
  const countries = ["de", "fr", "it", "pl", "se"];

  countries.forEach(async (country) => {
    const url = `${country}/dp/${asin}`;
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

const headlessTestAsin = () => {
  const asin = process.argv[2];
  const service = PlaywrightService.getInstance();
  const countries = ["fr", "it"];

  countries.forEach(async (country) => {
    const url = `${country}/dp/${asin}`;
  });

  setTimeout(() => {
    service.create("", "");
  }, 5000);
};

// setInterval(() => {
//   testAsin();
// }, 10000);

headlessTestAsin();
