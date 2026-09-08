import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Plugin } from 'vite';

export type ShopifyImportPeriod = 'last_month' | 'last_3_months' | 'last_6_months' | 'last_1_year' | 'lifetime';

type ShopifySyncEnv = Record<string, string | undefined>;
type JsonRecord = Record<string, unknown>;
type MoneyValue = { amount?: string | number | null; currencyCode?: string | null } | null | undefined;
type PageInfo = { hasNextPage?: boolean; endCursor?: string | null };

type ShopifyOrderNode = {
  id: string;
  name: string;
  createdAt: string;
  processedAt: string;
  displayFinancialStatus?: string | null;
  currencyCode: string;
  subtotalPriceSet?: { shopMoney?: MoneyValue } | null;
  totalDiscountsSet?: { shopMoney?: MoneyValue } | null;
  totalRefundedSet?: { shopMoney?: MoneyValue } | null;
  totalShippingPriceSet?: { shopMoney?: MoneyValue } | null;
  totalTaxSet?: { shopMoney?: MoneyValue } | null;
  totalPriceSet?: { shopMoney?: MoneyValue } | null;
  lineItems?: {
    pageInfo?: PageInfo;
    nodes?: Array<{
      sku?: string | null;
      name?: string | null;
      quantity?: number | null;
      originalUnitPriceSet?: { shopMoney?: MoneyValue } | null;
      totalDiscountSet?: { shopMoney?: MoneyValue } | null;
    }>;
  } | null;
};

type ShopifyProductNode = {
  id: string;
  handle: string;
  title: string;
  variants?: {
    pageInfo?: PageInfo;
    nodes?: Array<{
      id: string;
      sku?: string | null;
      inventoryQuantity?: number | null;
      inventoryItem?: { unitCost?: MoneyValue | null } | null;
    }>;
  } | null;
};

type ShopifyBalanceTransactionNode = {
  id: string;
  transactionDate: string;
  type: string;
  amount: MoneyValue;
  fee: MoneyValue;
  net: MoneyValue;
  associatedOrder?: { id: string; name: string } | null;
  associatedPayout?: { id?: string | null; status?: string | null } | null;
};

type ShopifyPayoutNode = {
  id: string;
  issuedAt: string;
  net: MoneyValue;
  status: string;
  transactionType: string;
  externalTraceId?: string | null;
  summary?: {
    chargesGross?: MoneyValue;
    chargesFee?: MoneyValue;
    refundsFeeGross?: MoneyValue;
    refundsFee?: MoneyValue;
    adjustmentsGross?: MoneyValue;
    adjustmentsFee?: MoneyValue;
    advanceGross?: MoneyValue;
    advanceFees?: MoneyValue;
    reservedFundsGross?: MoneyValue;
    reservedFundsFee?: MoneyValue;
    retriedPayoutsGross?: MoneyValue;
    retriedPayoutsFee?: MoneyValue;
  } | null;
};

type GraphQLResponse = {
  data?: JsonRecord | null;
  errors?: Array<{ message?: string | null }>;
};

type ShopifyRange = {
  from: string | null;
  to: string | null;
  label: string;
};

type ShopifySyncFile = {
  name: string;
  content: string;
  source: 'shopify_orders' | 'shopify_products' | 'shopify_payment_transactions' | 'payouts';
  rows: number;
};

type ShopifySyncPayload = {
  period: ShopifyImportPeriod;
  range: ShopifyRange;
  store: string;
  importedAt: string;
  files: ShopifySyncFile[];
  warnings: string[];
};

class ShopifyRequestError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = 'ShopifyRequestError';
  }
}

const API_VERSION_DEFAULT = '2026-07';
const CLI_TIMEOUT_MS = 120_000;
const AUTH_TIMEOUT_MS = 300_000;
const SHOPIFY_AUTH_SCOPES = 'read_orders,read_all_orders,read_products,read_inventory,read_shopify_payments';
const MAX_PAGES = 1_000;
const PERIOD_LABELS: Record<ShopifyImportPeriod, string> = {
  last_month: 'previous complete calendar month',
  last_3_months: 'previous 3 complete calendar months',
  last_6_months: 'previous 6 complete calendar months',
  last_1_year: 'previous 12 complete calendar months',
  lifetime: 'lifetime available in Shopify',
};
const PERIOD_MONTHS: Record<Exclude<ShopifyImportPeriod, 'lifetime'>, number> = {
  last_month: 1,
  last_3_months: 3,
  last_6_months: 6,
  last_1_year: 12,
};
const VALID_PERIODS = new Set<ShopifyImportPeriod>(['last_month', 'last_3_months', 'last_6_months', 'last_1_year', 'lifetime']);

class ShopifyCliError extends Error {
  constructor(message: string, readonly requiresAuth = false) {
    super(message);
    this.name = 'ShopifyCliError';
  }
}

const ORDERS_QUERY = `query ShopifyOrders($after: String, $query: String) {
  orders(first: 250, after: $after, query: $query, sortKey: PROCESSED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      createdAt
      processedAt
      displayFinancialStatus
      currencyCode
      subtotalPriceSet { shopMoney { amount currencyCode } }
      totalDiscountsSet { shopMoney { amount currencyCode } }
      totalRefundedSet { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } }
      totalTaxSet { shopMoney { amount currencyCode } }
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 250) {
        pageInfo { hasNextPage endCursor }
        nodes {
          sku
          name
          quantity
          originalUnitPriceSet { shopMoney { amount currencyCode } }
          totalDiscountSet { shopMoney { amount currencyCode } }
        }
      }
    }
  }
}`;

const PRODUCTS_QUERY = `query ShopifyProducts($after: String) {
  products(first: 250, after: $after, sortKey: TITLE) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      handle
      title
      variants(first: 250) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          sku
          inventoryQuantity
          inventoryItem { unitCost { amount currencyCode } }
        }
      }
    }
  }
}`;

const PAYMENTS_QUERY = `query ShopifyPayments($after: String, $query: String) {
  shopifyPaymentsAccount {
    balanceTransactions(first: 250, after: $after, query: $query, sortKey: PROCESSED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        transactionDate
        type
        amount { amount currencyCode }
        fee { amount currencyCode }
        net { amount currencyCode }
        associatedOrder { id name }
        associatedPayout { id status }
      }
    }
  }
}`;

const PAYOUTS_QUERY = `query ShopifyPayouts($after: String, $query: String) {
  shopifyPaymentsAccount {
    payouts(first: 250, after: $after, query: $query, sortKey: ISSUED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        issuedAt
        net { amount currencyCode }
        status
        transactionType
        externalTraceId
        summary {
          chargesGross { amount currencyCode }
          chargesFee { amount currencyCode }
          refundsFeeGross { amount currencyCode }
          refundsFee { amount currencyCode }
          adjustmentsGross { amount currencyCode }
          adjustmentsFee { amount currencyCode }
          advanceGross { amount currencyCode }
          advanceFees { amount currencyCode }
          reservedFundsGross { amount currencyCode }
          reservedFundsFee { amount currencyCode }
          retriedPayoutsGross { amount currencyCode }
          retriedPayoutsFee { amount currencyCode }
        }
      }
    }
  }
}`;

const toDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const moneyAmount = (money: MoneyValue) => String(money?.amount ?? '0.00');
const moneyCurrency = (money: MoneyValue, fallback = 'USD') => String(money?.currencyCode || fallback).toUpperCase();
const dateOnly = (value: string | null | undefined) => value ? value.slice(0, 10) : '';

function getShopifyRange(period: ShopifyImportPeriod, now = new Date()): ShopifyRange {
  if (period === 'lifetime') return { from: null, to: null, label: PERIOD_LABELS[period] };
  const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - PERIOD_MONTHS[period], 1);
  return { from: toDate(previousMonthStart), to: toDate(previousMonthEnd), label: PERIOD_LABELS[period] };
}

function searchQuery(range: ShopifyRange, field: 'processed_at' | 'transaction_dates' | 'issued_at') {
  if (!range.from || !range.to) return undefined;
  return `${field}:>=${range.from} ${field}:<=${range.to}`;
}

function jsonResponse(response: ServerResponse, status: number, body: JsonRecord) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

function normalizeStoreDomain(value: string) {
  const normalized = value.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) {
    throw new Error('SHOPIFY_STORE_DOMAIN must be a valid store.myshopify.com domain.');
  }
  return normalized;
}

function isAuthError(output: string) {
  return /auth|token|login|credential|access denied|unauthori[sz]ed|permission/i.test(output);
}

function cliErrorMessage(output: string) {
  const clean = output.replace(/\s+/g, ' ').trim();
  if (isAuthError(clean)) return 'Shopify authorization is required for this store.';
  return clean.slice(-500) || 'Shopify CLI could not execute the Admin API query.';
}

function parseCliJson(output: string): GraphQLResponse {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed) as GraphQLResponse;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)) as GraphQLResponse; } catch { /* fall through */ }
    }
  }
  throw new Error('Shopify CLI returned an unreadable response. Run the CLI command directly to check its authentication state.');
}

function runCli(env: ShopifySyncEnv, args: string[], timeoutMs: number) {
  const command = env.SHOPIFY_CLI_COMMAND?.trim() || 'shopify';
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new ShopifyCliError(`Shopify CLI timed out after ${Math.round(timeoutMs / 60_000)} minutes. Finish the Shopify authorization in the browser or try a shorter period.`));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer | string) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ShopifyCliError(`Could not start Shopify CLI: ${error.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const output = `${stderr}\n${stdout}`.trim();
        reject(new ShopifyCliError(cliErrorMessage(output), isAuthError(output)));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function authenticateShopifyStore(env: ShopifySyncEnv, store: string) {
  const args = ['store', 'auth', '--store', store, '--scopes', env.SHOPIFY_CLI_SCOPES?.trim() || SHOPIFY_AUTH_SCOPES, '--no-color', '--json'];
  try {
    await runCli(env, args, AUTH_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof ShopifyCliError && error.requiresAuth) {
      throw new ShopifyCliError('Shopify authorization did not complete. Finish the Shopify sign-in/approval flow, then try the import again.');
    }
    throw error instanceof Error ? error : new ShopifyCliError('Shopify authorization did not complete.');
  }
}

async function executeShopifyQuery(env: ShopifySyncEnv, store: string, query: string, variables: JsonRecord): Promise<GraphQLResponse> {
  const version = env.SHOPIFY_API_VERSION?.trim() || API_VERSION_DEFAULT;
  const args = ['store', 'execute', '--store', store, '--query', query, '--variables', JSON.stringify(variables), '--json'];
  if (version) args.push('--version', version);
  const result = await runCli(env, args, CLI_TIMEOUT_MS);
  try {
    const payload = parseCliJson(result.stdout);
    const errors = payload.errors?.map((error) => error.message).filter(Boolean) || [];
    if (errors.length) throw new ShopifyCliError(errors.join(' · '), isAuthError(errors.join(' · ')));
    return payload;
  } catch (error) {
    if (error instanceof ShopifyCliError) throw error;
    throw error instanceof Error ? error : new ShopifyCliError('Shopify CLI returned an invalid GraphQL response.');
  }
}

type ShopifyQueryExecutor = (query: string, variables: JsonRecord) => Promise<GraphQLResponse>;

let activeShopifyAuthorizationKey: string | null = null;
let shopifyCliQueue = Promise.resolve();

function createAuthenticatedShopifyExecutor(env: ShopifySyncEnv, store: string, userId: string): ShopifyQueryExecutor {
  const authorizationKey = `${userId}:${store}`;
  return async (query, variables) => {
    try {
      return await executeShopifyQuery(env, store, query, variables);
    } catch (error) {
      if (!(error instanceof ShopifyCliError) || !error.requiresAuth) throw error;
      await authenticateShopifyStore(env, store);
      activeShopifyAuthorizationKey = authorizationKey;
      return executeShopifyQuery(env, store, query, variables);
    }
  };
}

function pathValue(value: unknown, path: string[]) {
  let current: unknown = value;
  for (const part of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as JsonRecord)[part];
  }
  return current;
}

async function fetchConnection<T>(executeQuery: ShopifyQueryExecutor, query: string, connectionPath: string[], initialVariables: JsonRecord, onUnavailable?: string) {
  const nodes: T[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await executeQuery(query, { ...initialVariables, after });
    const connection = pathValue(response.data, connectionPath) as { nodes?: T[]; pageInfo?: PageInfo } | null | undefined;
    if (!connection) {
      if (onUnavailable) return { nodes, unavailable: onUnavailable };
      throw new Error(`Shopify returned no data for ${connectionPath.join('.')}.`);
    }
    nodes.push(...(connection.nodes || []));
    if (!connection.pageInfo?.hasNextPage) return { nodes, unavailable: undefined };
    after = connection.pageInfo.endCursor || null;
    if (!after) throw new Error(`Shopify did not return a cursor for ${connectionPath.join('.')}.`);
  }
  throw new Error(`Shopify returned more than ${MAX_PAGES * 250} rows. Choose a shorter period to keep the import responsive.`);
}

function transactionType(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === 'charge') return 'charge';
  if (normalized.includes('refund')) return 'refund';
  if (normalized.includes('chargeback')) return 'chargeback';
  if (normalized.includes('dispute_reversal')) return 'dispute_reversal';
  if (normalized.includes('marketplace') && normalized.includes('tax')) return 'marketplace sales tax';
  if (normalized === 'shop_cash_credit') return 'shop_cash_credit';
  return normalized.replace(/_/g, ' ');
}

function addMoney(...values: MoneyValue[]) {
  return values.reduce((sum, value) => sum + Number(value?.amount || 0), 0).toFixed(2);
}

function orderFile(orders: ShopifyOrderNode[]): ShopifySyncFile {
  const headers = ['Name', 'Created at', 'Financial Status', 'Currency', 'Gross sales', 'Discount Amount', 'Refunded Amount', 'Shipping', 'Taxes', 'Total', 'Lineitem sku', 'Lineitem name', 'Lineitem quantity', 'Lineitem price', 'Lineitem discount', 'Order ID'];
  const rows = orders.flatMap((order) => {
    const lineItems = order.lineItems?.nodes || [];
    const base = [order.name, order.createdAt, order.displayFinancialStatus || 'unknown', order.currencyCode, moneyAmount(order.subtotalPriceSet?.shopMoney), moneyAmount(order.totalDiscountsSet?.shopMoney), moneyAmount(order.totalRefundedSet?.shopMoney), moneyAmount(order.totalShippingPriceSet?.shopMoney), moneyAmount(order.totalTaxSet?.shopMoney), moneyAmount(order.totalPriceSet?.shopMoney)];
    if (!lineItems.length) return [[...base, '', '', '', '', '', order.id]];
    return lineItems.map((line) => [...base, line.sku || '', line.name || '', line.quantity || 0, moneyAmount(line.originalUnitPriceSet?.shopMoney), moneyAmount(line.totalDiscountSet?.shopMoney), order.id]);
  });
  return { name: 'shopify-orders-cli.csv', content: toCsv(headers, rows), source: 'shopify_orders', rows: orders.length };
}

function productFile(products: ShopifyProductNode[]): ShopifySyncFile {
  const headers = ['Handle', 'Title', 'Variant SKU', 'Cost per item', 'Inventory quantity', 'Currency', 'Product ID', 'Variant ID'];
  const rows = products.flatMap((product) => (product.variants?.nodes || []).map((variant) => [product.handle, product.title, variant.sku || '', moneyAmount(variant.inventoryItem?.unitCost), variant.inventoryQuantity ?? '', moneyCurrency(variant.inventoryItem?.unitCost), product.id, variant.id]));
  return { name: 'shopify-products-costs-cli.csv', content: toCsv(headers, rows), source: 'shopify_products', rows: rows.length };
}

function paymentFile(payments: ShopifyBalanceTransactionNode[], payoutById: Map<string, ShopifyPayoutNode>) {
  const headers = ['Transaction Date', 'Type', 'Amount', 'Fee', 'Net', 'Currency', 'Order', 'Payout ID', 'Payout Date', 'Payout Status', 'Payment Method Name', 'Transaction ID'];
  const rows = payments.map((payment) => {
    const payoutId = payment.associatedPayout?.id || '';
    const payout = payoutById.get(payoutId);
    return [payment.transactionDate, transactionType(payment.type), moneyAmount(payment.amount), moneyAmount(payment.fee), moneyAmount(payment.net), moneyCurrency(payment.amount), payment.associatedOrder?.name || payment.associatedOrder?.id || '', payoutId, payout ? dateOnly(payout.issuedAt) : '', payment.associatedPayout?.status || '', '', payment.id];
  });
  return { name: 'shopify-payments-cli.csv', content: toCsv(headers, rows), source: 'shopify_payment_transactions' as const, rows: payments.length };
}

function payoutFile(payouts: ShopifyPayoutNode[]): ShopifySyncFile {
  const headers = ['Payout Date', 'Payout ID', 'Status', 'Charges', 'Refunds', 'Adjustments', 'Marketplace Sales Tax', 'Fees', 'Total', 'Currency', 'Bank Reference', 'Transaction Type'];
  const rows = payouts.map((payout) => {
    const summary = payout.summary || {};
    const fees = addMoney(summary.chargesFee, summary.refundsFee, summary.adjustmentsFee, summary.advanceFees, summary.reservedFundsFee, summary.retriedPayoutsFee);
    return [dateOnly(payout.issuedAt), payout.id, payout.status.toLowerCase(), moneyAmount(summary.chargesGross), moneyAmount(summary.refundsFeeGross), moneyAmount(summary.adjustmentsGross), '0.00', fees, moneyAmount(payout.net), moneyCurrency(payout.net), payout.externalTraceId || payout.id, payout.transactionType.toLowerCase()];
  });
  return { name: 'shopify-payouts-cli.csv', content: toCsv(headers, rows), source: 'payouts', rows: payouts.length };
}

function readJsonBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > 20_000) reject(new Error('The Shopify import request is too large.'));
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

async function runShopifySyncUnlocked(env: ShopifySyncEnv, period: ShopifyImportPeriod, store: string, userId: string): Promise<ShopifySyncPayload> {
  const executeQuery = createAuthenticatedShopifyExecutor(env, store, userId);
  const range = getShopifyRange(period);
  const warnings: string[] = [];
  const files: ShopifySyncFile[] = [];
  const orderResult = await fetchConnection<ShopifyOrderNode>(executeQuery, ORDERS_QUERY, ['orders'], { query: searchQuery(range, 'processed_at') });
  if (orderResult.nodes.length) files.push(orderFile(orderResult.nodes));
  if (orderResult.nodes.some((order) => order.lineItems?.pageInfo?.hasNextPage)) warnings.push('Some orders contain more than 250 line items and were imported with the first 250 line items.');

  try {
    const productResult = await fetchConnection<ShopifyProductNode>(executeQuery, PRODUCTS_QUERY, ['products'], {});
    if (productResult.nodes.length) files.push(productFile(productResult.nodes));
    if (productResult.nodes.some((product) => product.variants?.pageInfo?.hasNextPage)) warnings.push('Some products contain more than 250 variants and were imported with the first 250 variants.');
  } catch (error) {
    warnings.push(`Products and costs were not imported: ${error instanceof Error ? error.message : 'Shopify returned an error.'}`);
  }

  let payouts: ShopifyPayoutNode[] = [];
  try {
    const payoutResult = await fetchConnection<ShopifyPayoutNode>(executeQuery, PAYOUTS_QUERY, ['shopifyPaymentsAccount', 'payouts'], { query: searchQuery(range, 'issued_at') }, 'Shopify Payments is not available for this store.');
    payouts = payoutResult.nodes;
    if (payoutResult.unavailable) warnings.push(payoutResult.unavailable);
    if (payouts.length) files.push(payoutFile(payouts));
  } catch (error) {
    warnings.push(`Payouts were not imported: ${error instanceof Error ? error.message : 'Shopify returned an error.'}`);
  }

  const payoutById = new Map(payouts.map((payout) => [payout.id, payout]));
  try {
    const paymentResult = await fetchConnection<ShopifyBalanceTransactionNode>(executeQuery, PAYMENTS_QUERY, ['shopifyPaymentsAccount', 'balanceTransactions'], { query: searchQuery(range, 'transaction_dates') }, 'Shopify Payments transactions are not available for this store.');
    if (paymentResult.unavailable) warnings.push(paymentResult.unavailable);
    if (paymentResult.nodes.length) files.push(paymentFile(paymentResult.nodes, payoutById));
  } catch (error) {
    warnings.push(`Payments were not imported: ${error instanceof Error ? error.message : 'Shopify returned an error.'}`);
  }

  if (!files.length) throw new Error('Shopify returned no importable rows. Check the selected period, store authentication, and required CLI scopes.');
  return { period, range, store, importedAt: new Date().toISOString(), files, warnings };
}

async function runShopifySync(env: ShopifySyncEnv, period: ShopifyImportPeriod, userId: string): Promise<ShopifySyncPayload> {
  const store = normalizeStoreDomain(env.SHOPIFY_STORE_DOMAIN || '');
  const authorizationKey = `${userId}:${store}`;
  const previous = shopifyCliQueue;
  let release!: () => void;
  shopifyCliQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    if (activeShopifyAuthorizationKey !== authorizationKey) {
      await authenticateShopifyStore(env, store);
      activeShopifyAuthorizationKey = authorizationKey;
    }
    return await runShopifySyncUnlocked(env, period, store, userId);
  } finally {
    release();
  }
}

function serverSupabaseConfig(env: ShopifySyncEnv) {
  const url = String(env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = String(env.VITE_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '').trim();
  return url && key ? { url, key } : null;
}

function bearerToken(request: IncomingMessage) {
  const authorization = Array.isArray(request.headers.authorization) ? request.headers.authorization[0] : request.headers.authorization;
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function requireAuthenticatedUser(request: IncomingMessage, env: ShopifySyncEnv) {
  const token = bearerToken(request);
  if (!token) throw new ShopifyRequestError(401, 'Sign in to import from Shopify.');
  const config = serverSupabaseConfig(env);
  if (!config) throw new ShopifyRequestError(503, 'Supabase server verification is not configured. Add the publishable Supabase URL and key to .env.local.');
  const authClient = createSupabaseClient(config.url, config.key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: { user }, error } = await authClient.auth.getUser(token);
  if (error || !user) throw new ShopifyRequestError(401, 'Your Supabase session is no longer valid. Sign in again and retry the Shopify import.');
  return user.id;
}

export function createShopifySyncPlugin(env: ShopifySyncEnv): Plugin {
  return {
    name: 'gcs-books-shopify-cli-sync',
    configureServer(server) {
      server.middlewares.use('/api/shopify/import', async (request, response) => {
        if (request.method !== 'POST') {
          jsonResponse(response, 405, { error: 'Use POST /api/shopify/import.' });
          return;
        }
        try {
          const userId = await requireAuthenticatedUser(request, env);
          const body = JSON.parse((await readJsonBody(request)) || '{}') as { period?: string };
          if (!body.period || !VALID_PERIODS.has(body.period as ShopifyImportPeriod)) {
            jsonResponse(response, 400, { error: 'Choose a valid Shopify import period.' });
            return;
          }
          const result = await runShopifySync(env, body.period as ShopifyImportPeriod, userId);
          jsonResponse(response, 200, result as unknown as JsonRecord);
        } catch (error) {
          const status = error instanceof ShopifyRequestError ? error.statusCode : 502;
          jsonResponse(response, status, { error: error instanceof Error ? error.message : 'Shopify import failed.' });
        }
      });
    },
  };
}
