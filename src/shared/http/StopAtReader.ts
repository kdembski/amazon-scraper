import type { Readable } from "node:stream";
import _ from "lodash";
import type { StopAt } from "@/shared/http/http.types";

export class StopAtReader {
  // Text of the stream up to the chunk that completes the markers in order
  read(stream: Readable, stopAt: StopAt) {
    return new Promise<string>((resolve, reject) => {
      const chunks: string[] = [];
      let unsearched = "";
      let next = 0;

      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        chunks.push(chunk);
        unsearched += chunk;

        while (next < stopAt.length) {
          const markers = _.castArray(stopAt[next]);
          const found = _.minBy(
            markers
              .map((marker) => ({ marker, index: unsearched.indexOf(marker) }))
              .filter(({ index }) => index !== -1),
            "index"
          );
          if (!found) {
            const longest = _.max(markers.map((marker) => marker.length))!;
            unsearched = unsearched.slice(Math.max(unsearched.length - longest + 1, 0));
            return;
          }

          unsearched = unsearched.slice(found.index + found.marker.length);
          next++;
        }

        stream.destroy();
        resolve(chunks.join(""));
      });
      stream.on("end", () => resolve(chunks.join("")));
      stream.on("error", reject);
    });
  }
}
