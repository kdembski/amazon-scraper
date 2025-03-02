import { AmazonPdpAdBuilder } from "@/builders/AmazonPdpAdBuilder";
import axios from "axios";
import { parseHTML } from "linkedom";
import { writeFileSync } from "node:fs";

const testAsin = () => {
  const asin = process.argv[2];
  const countries = ["fr"];

  countries.forEach(async (country) => {
    const url = `https://www.amazon.${country}/dp/${asin}`;
    axios
      .get<string>(url, { maxRedirects: 0 })
      .then((response) => {
        //console.log(response.status);
        writeFileSync(`test-html/${asin}-${country}.html`, response.data);
        const { document } = parseHTML(response.data);
        const ad = new AmazonPdpAdBuilder().build(document);
      })
      .catch((e) => {
        console.log(e.message);
      });
  });
};
setInterval(() => {
  testAsin();
}, 1000);
