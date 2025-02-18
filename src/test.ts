import axios from "axios";
import { writeFileSync } from "node:fs";

const testAsin = () => {
  const asin = process.argv[2];
  const countries = ["pl", "de", "se"];

  countries.forEach(async (country) => {
    const url = `https://www.amazon.${country}/dp/${asin}`;
    axios
      .get<string>(url, { maxRedirects: 0 })
      .then((response) => {
        console.log(response.status);
        writeFileSync(`test-html/${asin}-${country}.html`, response.data);
      })
      .catch((e) => {
        console.log(e.message);
      });
  });
};

testAsin();
