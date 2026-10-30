import { selectAll, selectOne } from "css-select";
import type { AnyNode, Element } from "domhandler";
import { textContent } from "domutils";

// css-select over an htmlparser2 document (parseDocument)
export const find = (selector: string, root: AnyNode) =>
  selectOne<AnyNode, Element>(selector, root);

export const findAll = (selector: string, root: AnyNode) =>
  selectAll<AnyNode, Element>(selector, root);

// htmlparser2 texts and attributes are V8 slices of the whole page; a kept
// slice keeps the page in memory, a copy does not
export const detach = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

export const text = (element: Element | null | undefined) =>
  element ? detach(textContent(element)) : undefined;
