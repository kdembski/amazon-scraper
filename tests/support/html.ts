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

// "All Offers Display" fragment (aodAjaxMain); without a price it is the
// "no featured offers" variant
export const aodPage = ({
  price,
  shipsFrom = "Amazon",
}: { price?: string; shipsFrom?: string } = {}) => {
  const [whole, fraction] = price?.split(",") ?? [];
  const priceBox = price
    ? `<div id="aod-price-0">${aPrice(whole, fraction)}</div>`
    : "";

  return `
    <div id="aod-container">
      <div id="aod-pinned-offer">
        ${priceBox}
        <div id="aod-offer-shipsFrom">
          <div class="a-col-left"><span>Versand</span></div>
          <div class="a-col-right"><span class="a-size-small">${shipsFrom}</span></div>
        </div>
      </div>
    </div>
  `;
};

// Entry of the category filter, indent 1 is the current category, 2 its child
export const categoryItem = (id: string, indent?: 1 | 2) =>
  `<li id="${id}" class="a-spacing-micro${
    indent ? ` s-navigation-indent-${indent}` : ""
  }"><a>${id}</a></li>`;

// Pagination of a search listing, "next" is a link only if there is a next page
export const pagination = (next: boolean) =>
  next
    ? `<a href="/s?page=2" class="s-pagination-item s-pagination-next">Dalej</a>`
    : `<span class="s-pagination-item s-pagination-next s-pagination-disabled">Dalej</span>`;

// Search listing (/s?i=...) with products and the category filter: the path
// from the root to the current category, then its children
export const plpPage = ({
  asins = [] as string[],
  path = [] as string[],
  subcategories = [] as string[],
  next = false,
} = {}) => `
  <div class="s-main-slot">
    ${asins
      .map(
        (asin) => `
          <div role="listitem" data-asin="${asin}">
            <img src="https://m.media-amazon.com/images/I/${asin}.jpg" />
            <a href="/dp/${asin}"><h2><span>Product ${asin}</span></h2></a>
          </div>
        `
      )
      .join("")}
  </div>
  <ul id="filter-n">
    ${path
      .map((id, index) =>
        categoryItem(id, index === path.length - 1 ? 1 : undefined)
      )
      .join("")}
    ${subcategories.map((id) => categoryItem(id, 2)).join("")}
  </ul>
  ${pagination(next)}
`;
