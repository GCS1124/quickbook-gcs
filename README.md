# GCS Books

GCS Books is a React + Vite personal-finance workspace for accounts, transactions, budgets, goals, recurring payments, investments, lending, reports, analytics, and source-aware payment imports.

## Run locally

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and keep the Supabase URL and publishable key aligned with the active GCS Books project. This Vite app accepts both `VITE_SUPABASE_*` and the `NEXT_PUBLIC_SUPABASE_*` aliases from Supabase's Next.js setup instructions. Never put a `service_role` key in browser environment variables.

The Supabase integration lives in `src/lib/supabase.ts`. Because this repository is a browser-only Vite SPA, it uses `createBrowserClient` with persisted sessions, URL detection, and automatic token refresh. After a user session is available, `src/lib/realtime.ts` opens one user-scoped Postgres Changes channel for all finance tables and background-refreshes every view when data changes. The header badge shows whether live updates are connected; demo mode correctly stays local-only. Next.js server helpers and `middleware.ts` are intentionally not added: they require a Next runtime and would not run in this application. The connected project already has the finance tables, foreign keys, authenticated-only RLS policies, and `supabase_realtime` publication entries used by the app.

The realtime publication is kept reproducible in `supabase/migrations/20260908110000_enable_finance_realtime.sql`. RLS still controls which user-scoped rows a signed-in session can receive; enabling publication does not make finance data public.

## Shopify import workflow

Open Shopify import center from the sidebar or the connected-data ribbon visible on every workspace page. For a holistic P&L, export the same period from Shopify and upload these five sources together:

### Live Shopify CLI import

The import center now includes **Import from Shopify**. On first use for each signed-in GCS Books user, it asks for that user's actual Shopify store domain and reporting period, then the Vite server runs Shopify CLI's authenticated Admin GraphQL queries for orders, product costs, Shopify Payments transactions, and payouts. The returned records are converted into the same source-aware import pipeline used by uploaded files, so they flow through the ledger, P&L, reports, analytics, and calendar.

This bridge is intentionally server-side: no Admin token is sent to the browser. During local development, the request is handled by the Vite middleware and the CLI automatically uses the actual Shopify store domain supplied by the user, authorizing that store only when needed. No Shopify app selection or `SHOPIFY_STORE_DOMAIN` variable is required. The URL preference is kept in a browser key scoped to the signed-in GCS Books user, while production Shopify tokens are encrypted in a separate Supabase connection row per user. Use the canonical Shopify URL/domain shown in Shopify Settings → Domains, such as `https://your-store.myshopify.com/admin` or `your-store.myshopify.com`:

1. Copy `.env.example` to `.env.local`; leave `SHOPIFY_STORE_DOMAIN` unset so each signed-in user can paste their own actual store domain in the dialog.
2. Start the app with `npm run dev`, sign in, open Shopify import center, click **Import from Shopify**, paste the actual canonical Shopify store domain, and choose **Last month**, **Last 3 months**, **Last 6 months**, **Last 1 year**, or **Lifetime**. The button automatically runs the query against that domain; if its CLI session is not authorized yet, it starts `shopify store auth`, opens Shopify’s approval page, and continues after approval. There is no separate app-link or pre-auth selection step.

Shopify admin URLs use a store handle that is not always the API domain. When an admin URL cannot be safely matched to an authenticated CLI store, GCS Books asks for the canonical `*.myshopify.com` domain instead of guessing and risking an import from the wrong store.

The first-use authorization requests `read_orders,read_all_orders,read_products,read_inventory,read_shopify_payments`. Set `SHOPIFY_CLI_SCOPES` only if the store’s approved permissions need a deliberate override. The server serializes CLI work and always submits the resulting import under the authenticated GCS Books user, so user data stays isolated even when the local CLI session is shared by the machine. See the official [store auth](https://shopify.dev/docs/api/shopify-cli/store/store-auth) and [store execute](https://shopify.dev/docs/api/shopify-cli/store/store-execute) references.

### Production Shopify connection

Vercel cannot keep a developer machine’s interactive Shopify CLI session. The deployed app therefore supports two server-side modes at `/api/shopify/import`: OAuth for external merchant stores, or Shopify’s client-credentials grant for a store owned by the same Shopify organization as the app. Both modes use the same server-only Admin GraphQL/import pipeline, keep each GCS Books user scoped through Supabase, and never send a Shopify token to browser storage.

For a no-approval native server connection on Vercel, use `SHOPIFY_CONNECTION_MODE=client_credentials`. This exchanges the app credentials for a short-lived Shopify token on the server, encrypts the token in `finance_shopify_connections`, reuses it while valid, and refreshes it automatically before expiry. This mode is only appropriate when the app and store belong to the same Shopify organization. For a customer or other external merchant store, keep `SHOPIFY_CONNECTION_MODE=oauth`; the first import opens Shopify approval for that signed-in GCS Books user. Local development continues to use the native Shopify CLI flow.

Create a Shopify standalone/API-only app, register `https://quickbook-gcs.vercel.app/api/shopify/oauth/callback` as an allowed redirect URL, and add these server-only variables to the Vercel Production environment before deploying:

```ini
SHOPIFY_CONNECTION_MODE=oauth
# Optional default store. If omitted, the signed-in user chooses a store in
# the live import dialog at runtime.
# SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_APP_CLIENT_ID=your-shopify-app-client-id
SHOPIFY_APP_CLIENT_SECRET=your-shopify-app-client-secret
SHOPIFY_APP_REDIRECT_URI=https://quickbook-gcs.vercel.app/api/shopify/oauth/callback
SHOPIFY_TOKEN_ENCRYPTION_KEY=a-long-random-secret
SHOPIFY_OAUTH_STATE_SECRET=a-different-long-random-secret
```

For the no-approval Vercel mode, set `SHOPIFY_CONNECTION_MODE=client_credentials` and add `VITE_SHOPIFY_CONNECTION_MODE=client_credentials` as a public build variable so the import dialog describes the active connection. Set `SHOPIFY_STORE_DOMAIN` or `SHOPIFY_ALLOWED_STORE_DOMAINS` on the server; runtime store selection is restricted to that allowlist so the app secret is never sent to an unapproved Shopify domain. The app client ID/secret, Supabase variables, and token-encryption secret are still required. The OAuth redirect and state secret are not needed by the client-credentials mode. Never expose the client secret or encryption secret through `VITE_*` or `NEXT_PUBLIC_*`.

Never prefix server-only values with `VITE_` or `NEXT_PUBLIC_`. The client secret and Shopify access tokens stay in the Vercel function and the encrypted Supabase `finance_shopify_connections` table. Apply the latest migration before the first production import. Both production modes send the resulting access token only from the server in the `X-Shopify-Access-Token` header.

The first four options use complete calendar months. Lifetime reads all data available to the authenticated CLI session; historical orders older than Shopify's default 60-day window require the `read_all_orders` permission. Product costs also require access to product costs in Shopify. If the store does not use Shopify Payments, the sync keeps orders and products and explains why payments or payouts are unavailable.

Shopify does not expose every merchant operating cost through the Admin API. Add apps, ads, fulfilment, payroll, and other costs with the supplied operating-expense template to turn the imported sales and cost data into a complete operating P&L.

### Manual export pack

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
