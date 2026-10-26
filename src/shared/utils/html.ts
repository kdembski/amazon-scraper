import { selectAll, selectOne } from "css-select";
import type { AnyNode, Element } from "domhandler";
import { textContent } from "domutils";

// css-select over an htmlparser2 document (parseDocument)
export const find = (selector: string, root: AnyNode) =>
  selectOne<AnyNode, Element>(selector, root);

export const findAll = (selector: string, root: AnyNode) =>
  selectAll<AnyNode, Element>(selector, root);

export const text = (element: Element | null | undefined) =>
  element ? textContent(element) : undefined;
