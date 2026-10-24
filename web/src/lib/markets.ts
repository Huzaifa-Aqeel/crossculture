// Countries a brand can sell in; mirrors the API's supported markets.
export const MARKETS: { code: string; name: string; currency: string }[] = [
  { code: "US", name: "United States", currency: "USD" },
  { code: "CA", name: "Canada", currency: "CAD" },
  { code: "GB", name: "United Kingdom", currency: "GBP" },
  { code: "IE", name: "Ireland", currency: "EUR" },
  { code: "AU", name: "Australia", currency: "AUD" },
  { code: "NZ", name: "New Zealand", currency: "NZD" },
  { code: "DE", name: "Germany", currency: "EUR" },
  { code: "FR", name: "France", currency: "EUR" },
  { code: "NL", name: "Netherlands", currency: "EUR" },
];

export const marketName = (code: string) => MARKETS.find((item) => item.code === code)?.name ?? code;
export const marketCurrency = (code: string) => MARKETS.find((item) => item.code === code)?.currency ?? "USD";

export const GOALS: Record<string, { label: string; short: string; detail: string }> = {
  product_bundle: { label: "Product bundle", short: "Bundle",
    detail: "Pair your product with a partner product that is used with it." },
  cross_sell: { label: "Cross-sell", short: "Cross-sell",
    detail: "Suggest a partner product that meets a related need of your customers." },
};
