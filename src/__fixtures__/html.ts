import { parseHTML } from "linkedom";

// Wraps a markup fragment into a full page, the way builders receive it
export const toDocument = (body: string) => {
  const { document } = parseHTML(
    `<!doctype html><html><head></head><body>${body}</body></html>`
  );
  return document as unknown as Document;
};

export const captchaPage = `
  <form method="get" action="/errors/validateCaptcha">
    <input type="hidden" name="amzn" value="abc" />
  </form>
`;

// Price markup as Amazon renders it inside .a-price
export const aPrice = (whole: string, fraction: string, offscreen = "") => `
  <span class="a-price">
    <span class="a-offscreen">${offscreen}</span>
    <span aria-hidden="true">
      <span class="a-price-whole">${whole}<span class="a-price-decimal">,</span></span>
      <span class="a-price-fraction">${fraction}</span>
      <span class="a-price-symbol">€</span>
    </span>
  </span>
`;
