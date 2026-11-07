import type { Readable } from "node:stream";
import _ from "lodash";
import type { StopAt } from "@/shared/http/http.types";

export class StopAtReader {
  // Text of the stream up to the chunk that completes the markers in order
  read(stream: Readable, stopAt: StopAt) {
    return new Promise<string>((resolve, reject) => {
      let text = "";
      let next = 0;
      let from = 0;

      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        text += chunk;
        while (next < stopAt.length) {
          const markers = _.castArray(stopAt[next]);
          const found = _.minBy(
            markers
              .map((marker) => ({ marker, index: text.indexOf(marker, from) }))
              .filter(({ index }) => index !== -1),
            "index"
          );
          if (!found) {
            from = Math.max(from, text.length - _.max(markers.map((marker) => marker.length))!);
            return;
          }
          from = found.index + found.marker.length;
          next++;
        }
        stream.destroy();
        resolve(text);
      });
      stream.on("end", () => resolve(text));
      stream.on("error", reject);
    });
  }
}
