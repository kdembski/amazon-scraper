import { parseDocument } from "htmlparser2";
import { describe, expect, it } from "vitest";
import { detach, find, findAll, text } from "@/shared/utils/html";

const document = parseDocument(`
  <ul id="list">
    <li class="item" data-id="1">One <b>bold</b></li>
    <li class="item" data-id="2">Two</li>
  </ul>
`);

describe("html", () => {
  it("finds the first matching element", () => {
    expect(find("li.item", document)?.attribs["data-id"]).toBe("1");
  });

  it("finds nothing when no element matches", () => {
    expect(find("table", document)).toBeNull();
  });

  it("searches only inside the given root", () => {
    const second = findAll("li", document)[1];
    expect(find("b", second)).toBeNull();
  });

  it("finds all matching elements", () => {
    expect(findAll("#list .item", document).map((li) => li.attribs["data-id"])).toEqual(["1", "2"]);
  });

  it("returns the text of an element and its descendants", () => {
    expect(text(find("li", document))).toBe("One bold");
  });

  it("returns undefined text for a missing element", () => {
    expect(text(find("table", document))).toBeUndefined();
  });

  it("detaches a value from the page", () => {
    expect(detach(find("li", document)?.attribs.class)).toBe("item");
    expect(detach(undefined)).toBeUndefined();
  });
});
