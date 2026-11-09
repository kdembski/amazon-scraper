import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { StopAt } from "@/shared/http/http.types";
import { StopAtReader } from "@/shared/http/StopAtReader";

const stopAt = ["<b>", "&&&"];
const reader = new StopAtReader();
const streamOf = (chunks: (string | Buffer)[], error?: Error) =>
  Readable.from(
    (async function* () {
      for (const chunk of chunks) yield Buffer.from(chunk);
      if (error) throw error;
    })()
  );
const read = (chunks: (string | Buffer)[], markers: StopAt = stopAt) =>
  reader.read(streamOf(chunks), markers);

describe("StopAtReader", () => {
  it("cuts after the chunk with the last marker and destroys the stream", async () => {
    const stream = streamOf(["<a>", "<b>x&&&y", "rest"]);

    await expect(reader.read(stream, stopAt)).resolves.toBe("<a><b>x&&&y");

    expect(stream.destroyed).toBe(true);
  });

  it("cuts at markers split across chunks", async () => {
    await expect(read(["<a><", "b>x&&", "&y", "rest"])).resolves.toBe("<a><b>x&&&y");
  });

  it("cuts at a marker split across more than two chunks", async () => {
    await expect(read(["<b>x&", "&", "&y", "rest"])).resolves.toBe("<b>x&&&y");
  });

  it("finds the next marker in the rest of the chunk with the previous one", async () => {
    await expect(read(["<a>&&&<b>", "x", "&&&y", "rest"])).resolves.toBe("<a>&&&<b>x&&&y");
  });

  it("ignores a later marker seen before the earlier one", async () => {
    await expect(read(["&&&", "<b>", "x&&&", "rest"])).resolves.toBe("&&&<b>x&&&");
  });

  it("cuts at whichever alternative marker comes first", async () => {
    const markers = ["<b>", ["##", "&&&"]];

    await expect(read(["<b>x", "&&&y", "##z", "rest"], markers)).resolves.toBe("<b>x&&&y");
    await expect(read(["<b>x#", "#y", "&&&z", "rest"], markers)).resolves.toBe("<b>x##y");
  });

  it("passes the whole response when the markers never arrive", async () => {
    await expect(read(["<a>", "<b>"])).resolves.toBe("<a><b>");
  });

  it("decodes a character split across chunks", async () => {
    const euro = Buffer.from("€");

    await expect(read([euro.subarray(0, 1), euro.subarray(1)], ["x"])).resolves.toBe("€");
  });

  it("rejects on a stream error", async () => {
    await expect(reader.read(streamOf(["<a>"], new Error("reset")), stopAt)).rejects.toThrow("reset");
  });
});
