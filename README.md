# GCS Books

GCS Books is a React + Vite personal-finance workspace for accounts, transactions, budgets, goals, recurring payments, investments, lending, reports, analytics, and source-aware payment imports.

## Run locally

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and keep the Supabase URL and publishable key aligned with the active GCS Books project. This Vite app accepts both `VITE_SUPABASE_*` and the `NEXT_PUBLIC_SUPABASE_*` aliases from Supabase's Next.js setup instructions. Never put a `service_role` key in browser environment variables.

The Supabase integration lives in `src/lib/supabase.ts`. Because this repository is a browser-only Vite SPA, it uses `createBrowserClient` with persisted sessions, URL detection, and automatic token refresh. Next.js server helpers and `middleware.ts` are intentionally not added: they require a Next runtime and would not run in this application. The connected project already has the finance tables, foreign keys, and authenticated-only RLS policies used by the app.

## Shopify import workflow

Open Shopify import center from the sidebar or the connected-data ribbon visible on every workspace page. For a holistic P&L, export the same period from Shopify and upload these five sources together:

1. Orders → Export → All orders → All information
2. Products → Export → All products, with `Variant SKU` and `Cost per item`
3. Finance → Payouts → View transactions → Export CSV (payment transactions)
4. Payout activity / settlement export or a text-based payout activity PDF
5. Operating expenses using the downloadable template for Shopify billing, apps, ads, fulfilment, payroll, and other costs outside the Shopify order export

Orders supply gross sales, discounts, returns, shipping, taxes, and line items. Product costs supply COGS. Payment transactions supply processor fees, while payouts stay separate for cash reconciliation. The estimated operating profit is calculated as `net sales + shipping revenue - COGS - payment fees - operating expenses`; taxes collected and payout timing are shown separately. Shopify's official export references: [orders](https://help.shopify.com/en/manual/fulfillment/managing-orders/exporting-orders), [sales reports](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/sales-report), [product CSV](https://help.shopify.com/en/manual/products/import-export/using-csv), and [Shopify Payments transactions](https://help.shopify.com/en/manual/payments/shopify-payments/getting-paid-with-shopify-payments/view-payouts/view-details).

CSV files are parsed locally, deduplicated by source fingerprint, and persisted with user-scoped RLS when signed in. Imported payments continue to feed the transaction ledger; all five source datasets flow into the import center, reports, analytics, and connected-data ribbon. Demo imports stay local and signed-in imports can be removed as a batch.

## Checks

```bash
npm run typecheck
npm run lint
npm run build
```
