import { parseDocument } from "htmlparser2";

// Wraps a markup fragment into a full page, the way builders receive it
export const toDocument = (body: string) =>
  parseDocument(`<!doctype html><html><head></head><body>${body}</body></html>`);

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

// Pagination of a search listing as Amazon renders it on page 1: the first
// pages, an ellipsis, the last page and "next"; none for a single page
export const pagination = (lastPage: number) =>
  lastPage > 1
    ? `
      <span class="s-pagination-item s-pagination-selected">1</span>
      <a href="/s?page=2" class="s-pagination-item s-pagination-button">2</a>
      <span class="s-pagination-item s-pagination-ellipsis"></span>
      <span class="s-pagination-item s-pagination-disabled">${lastPage}</span>
      <a href="/s?page=2" class="s-pagination-item s-pagination-next">Dalej</a>
    `
    : "";

export const noResults = `
  <div data-csa-c-content-id="messaging-messages-no-results">
    <span>Brak wyników dla Twojego zapytania.</span>
  </div>
`;

// Search listing (/s?i=...) with products; empty is a search without results
export const plpPage = ({
  asins = [] as string[],
  lastPage = 1,
  empty = false,
} = {}) => `
  <div data-component-type="s-search-results" class="s-main-slot">
    ${empty ? noResults : ""}
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
  ${pagination(lastPage)}
`;

// New releases ranking (gp/new-releases/<category>[/<node>]): products, the
// browse tree with links to the given nodes and a link to page 2 if next
export const newReleasesPage = ({
  category = "electronics",
  asins = [] as string[],
  nodes = [] as string[],
  next = false,
} = {}) => `
  <ul class="_p13n-zg-nav-tree-all_style_zg-browse-group__88fbz">
    ${nodes
      .map(
        (node) =>
          `<li><a href="/gp/new-releases/${category}/${node}/ref=zg_bsnr_nav_${category}_1">${node}</a></li>`
      )
      .join("")}
  </ul>
  ${asins
    .map(
      (asin) => `
        <div id="gridItemRoot">
          <div data-asin="${asin}">
            <img src="https://images-eu.ssl-images-amazon.com/images/I/${asin}.jpg" />
            <a href="/dp/${asin}"><span><div class="_cDEzb_p13n-sc-css-line-clamp-3_g3dy1"> Product ${asin} </div></span></a>
          </div>
        </div>
      `
    )
    .join("")}
  ${next ? `<a href="/gp/new-releases/${category}/ref=zg_bsnr_pg_2_${category}?ie=UTF8&pg=2">2</a>` : ""}
`;
