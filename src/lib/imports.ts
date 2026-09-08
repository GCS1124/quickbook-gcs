import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from './supabase';

export type ImportSourceKind = 'payment_transactions' | 'shopify_payment_transactions' | 'shopify_orders' | 'shopify_products' | 'operating_expenses' | 'payouts';

export type ImportReviewRow = {
  row_number: number;
  reason: string;
  raw_data: Record<string, string>;
};

export type ImportedPayment = {
  id?: string;
  batch_id?: string;
  source_key: string;
  transaction_at: string;
  transaction_date: string;
  event_type: string;
  order_id: string | null;
  card_brand: string | null;
  card_source: string | null;
  payout_status: string | null;
  payout_date: string | null;
  payout_id: string | null;
  available_on: string | null;
  amount: string;
  fee: string;
  net: string;
  checkout_id: string | null;
  payment_method_name: string | null;
  presentment_amount: string | null;
  presentment_currency: string | null;
  currency: string;
  raw_data: Record<string, string>;
};

export type ImportedPayout = {
  id?: string;
  batch_id?: string;
  source_key: string;
  payout_date: string;
  status: string;
  charges: string;
  refunds: string;
  adjustments: string;
  marketplace_sales_tax: string;
  advances: string;
  reserved_funds: string;
  fees: string;
  retried_amount: string;
  total: string;
  currency: string;
  bank_reference: string;
  raw_data: Record<string, string>;
};

export type ShopifyOrderLine = {
  sku: string | null;
  title: string | null;
  quantity: number;
  unit_price: string;
  discount: string;
};

export type ShopifyOrder = {
  id?: string;
  batch_id?: string;
  source_key: string;
  order_name: string;
  order_date: string;
  financial_status: string;
  currency: string;
  gross_sales: string;
  discounts_amount: string;
  returns_amount: string;
  shipping_amount: string;
  taxes_amount: string;
  total_sales: string;
  item_quantity: number;
  line_items: ShopifyOrderLine[];
  raw_data: Record<string, string>;
};

export type ShopifyProduct = {
  id?: string;
  batch_id?: string;
  source_key: string;
  sku: string | null;
  product_title: string;
  cost_per_item: string;
  inventory_quantity: number | null;
  currency: string;
  raw_data: Record<string, string>;
};

export type OperatingExpense = {
  id?: string;
  batch_id?: string;
  source_key: string;
  expense_date: string;
  category: string;
  description: string;
  amount: string;
  currency: string;
  raw_data: Record<string, string>;
};

export type FinanceImportBatch = {
  id: string;
  user_id: string;
  file_name: string;
  file_type: 'csv' | 'pdf';
  source_kind: ImportSourceKind;
  file_size: number;
  row_count: number;
  imported_count: number;
  duplicate_count: number;
  review_count: number;
  total_amount: number | string;
  total_fee: number | string;
  total_net: number | string;
  currency_code: string;
  status: 'processing' | 'completed' | 'failed';
  imported_at: string;
  metadata?: { review_rows?: ImportReviewRow[] } | null;
};

export type ImportData = {
  batches: FinanceImportBatch[];
  payments: ImportedPayment[];
  payouts: ImportedPayout[];
  orders: ShopifyOrder[];
  products: ShopifyProduct[];
  expenses: OperatingExpense[];
};

export type ParsedImport = {
  source_kind: ImportSourceKind;
  file_type: 'csv' | 'pdf';
  payments: ImportedPayment[];
  payouts: ImportedPayout[];
  orders: ShopifyOrder[];
  products: ShopifyProduct[];
  expenses: OperatingExpense[];
  reviewRows: ImportReviewRow[];
};

export type ImportBreakdown = { label: string; count: number; amount: number };
export type ImportMonthlyTrend = { month: string; records: number; gross: number; net: number; fees: number };
export type ImportAnalysis = {
  paymentRows: number;
  payoutRows: number;
  orderRows: number;
  productRows: number;
  expenseRows: number;
  totalRows: number;
  grossVolume: number;
  paymentFees: number;
  paymentNet: number;
  refundsTotal: number;
  chargebacksTotal: number;
  marketplaceSalesTaxTotal: number;
  netTransactionMovement: number;
  positivePaymentNet: number;
  negativePaymentNet: number;
  payoutTotal: number;
  payoutFees: number;
  payoutRefunds: number;
  payoutAdjustments: number;
  payoutTaxes: number;
  reconciliationDifference: number;
  reconciledPayouts: number;
  balancedPayouts: number;
  unmatchedPayouts: number;
  reconciliationMatchMode: 'payout_id' | 'payout_date' | 'none';
  uniqueOrders: number;
  paidRows: number;
  pendingRows: number;
  dateFrom: string | null;
  dateTo: string | null;
  currency: string;
  eventBreakdown: ImportBreakdown[];
  statusBreakdown: ImportBreakdown[];
  monthlyTrend: ImportMonthlyTrend[];
  topOrders: ImportBreakdown[];
  grossSales: number;
  discountsAmount: number;
  returnsAmount: number;
  netSales: number;
  shippingRevenue: number;
  taxesCollected: number;
  cogs: number;
  cogsMatchedUnits: number;
  cogsUnmatchedUnits: number;
  operatingExpenses: number;
  estimatedOperatingProfit: number;
  pnlReady: boolean;
  pnlMissingExports: string[];
};

export type ShopifyExportRequirement = {
  kind: ImportSourceKind;
  label: string;
  description: string;
  exportPath: string;
};

export const SHOPIFY_EXPORT_REQUIREMENTS: ShopifyExportRequirement[] = [
  { kind: 'shopify_orders', label: 'Orders export', description: 'All order details with line items, discounts, returns, shipping, and taxes.', exportPath: 'Orders → Export → All orders → All information' },
  { kind: 'shopify_products', label: 'Products + cost export', description: 'Product CSV with Variant SKU and Cost per item for COGS.', exportPath: 'Products → Export → All products' },
  { kind: 'shopify_payment_transactions', label: 'Payments transactions', description: 'Captured payments, refunds, disputes, and Shopify Payments fees.', exportPath: 'Finance → Payouts → View transactions → Export CSV' },
  { kind: 'payouts', label: 'Payout activity', description: 'Settlement totals for bank reconciliation and cash timing.', exportPath: 'Finance → Payouts → View transactions → Export or Activity report PDF' },
  { kind: 'operating_expenses', label: 'Operating expenses', description: 'Shopify billing, apps, ads, fulfilment, payroll, and other costs outside order exports.', exportPath: 'Use the supplied CSV template and enter one expense per row' },
];

export const emptyImportData: ImportData = { batches: [], payments: [], payouts: [], orders: [], products: [], expenses: [] };

const normalizeHeader = (value: string) => value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, ' ');
const shopifyTransactionTypes = new Set(['charge', 'refund', 'chargeback', 'dispute_reversal', 'marketplace sales tax', 'shop_cash_credit']);
const normalizeShopifyTransactionType = (value: string) => {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalized === 'shop cash credit') return 'shop_cash_credit';
  return shopifyTransactionTypes.has(normalized) ? normalized : 'uncategorized';
};
const fingerprintPart = (value: string | null | undefined) => encodeURIComponent(value ?? '');
const decimalInputPattern = /^[+-]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)$/;
const isDecimalInput = (value: string) => {
  const raw = value.trim();
  if (!raw) return true;
  const unsigned = raw.startsWith('(') && raw.endsWith(')') ? raw.slice(1, -1) : raw;
  return decimalInputPattern.test(unsigned) && Number.isFinite(Number(unsigned.replace(/,/g, '')));
};

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') { field += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === ',' && !quoted) { row.push(field); field = ''; continue; }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((item) => item.trim())) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (quoted) throw new Error('This CSV contains an unclosed quoted field. Check the export and try again.');
  if (field || row.length) { row.push(field); if (row.some((item) => item.trim())) rows.push(row); }
  return rows;
}

export const normalizeDecimal = (value: string | number | null | undefined) => {
  const raw = String(value ?? '').trim().replace(/,/g, '');
  if (!raw) return '0.00';
  const negative = raw.startsWith('-') || (raw.startsWith('(') && raw.endsWith(')'));
  const unsigned = raw.replace(/[()]/g, '').replace(/^[+-]/, '');
  const [integerPart = '0', fractionPart = ''] = unsigned.split('.');
  const integer = integerPart.replace(/\D/g, '').replace(/^0+(?=\d)/, '') || '0';
  const fraction = `${fractionPart.replace(/\D/g, '')}00`.slice(0, 2);
  return `${negative ? '-' : ''}${integer}.${fraction}`;
};

export const absoluteDecimal = (value: string) => normalizeDecimal(value).replace(/^-/, '');
const isNegative = (value: string) => normalizeDecimal(value).startsWith('-');
const positiveAmount = (value: string, fallback: string) => {
  const normalized = normalizeDecimal(value);
  return normalized === '0.00' ? absoluteDecimal(fallback) : absoluteDecimal(normalized);
};

const parseDate = (value: string | null | undefined) => {
  if (!value?.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
  return parsed.toISOString().slice(0, 10);
};

const parseDateTime = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const shopifyDate = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\s+([+-]\d{4}|Z))?$/);
  const normalized = shopifyDate ? `${shopifyDate[1]}T${shopifyDate[2]}${shopifyDate[3] ? shopifyDate[3] === 'Z' ? 'Z' : `${shopifyDate[3].slice(0, 3)}:${shopifyDate[3].slice(3)}` : 'Z'}` : trimmed;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export function parsePaymentTransactionsCsv(text: string): { source_kind: 'shopify_payment_transactions'; payments: ImportedPayment[]; reviewRows: ImportReviewRow[] } {
  const rows = parseCsvRows(text);
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) throw new Error('The CSV file is empty.');
  const headers = headerRow.map(normalizeHeader);
  const indexOf = (name: string) => headers.indexOf(normalizeHeader(name));
  const get = (row: string[], name: string) => { const index = indexOf(name); return index >= 0 ? row[index]?.trim() || '' : ''; };
  const required = ['transaction date', 'type', 'amount', 'fee', 'net'];
  const missing = required.filter((name) => indexOf(name) < 0);
  if (missing.length) throw new Error(`This CSV is not a Shopify payment transactions export. Missing required columns: ${missing.join(', ')}.`);

  const payments: ImportedPayment[] = [];
  const reviewRows: ImportReviewRow[] = [];
  dataRows.forEach((row, rowIndex) => {
    const rawData = Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() || '']));
    const rawTransactionDate = get(row, 'transaction date');
    const transactionAt = parseDateTime(rawTransactionDate);
    const transactionDate = /^\d{4}-\d{2}-\d{2}/.test(rawTransactionDate) ? rawTransactionDate.slice(0, 10) : parseDate(rawTransactionDate);
    const rawType = get(row, 'type');
    const eventType = normalizeShopifyTransactionType(rawType);
    const hasMoneyValue = ['amount', 'fee', 'net'].some((name) => get(row, name) !== '');
    if (!transactionAt || !transactionDate) { reviewRows.push({ row_number: rowIndex + 2, reason: 'Invalid or missing Transaction Date.', raw_data: rawData }); return; }
    if (!rawType) { reviewRows.push({ row_number: rowIndex + 2, reason: 'Missing transaction Type.', raw_data: rawData }); return; }
    if (!hasMoneyValue) { reviewRows.push({ row_number: rowIndex + 2, reason: 'Amount, Fee, and Net are all empty.', raw_data: rawData }); return; }
    const invalidMoneyField = ['amount', 'fee', 'net'].find((name) => !isDecimalInput(get(row, name)));
    if (invalidMoneyField) { reviewRows.push({ row_number: rowIndex + 2, reason: `Invalid ${invalidMoneyField} value.`, raw_data: rawData }); return; }
    const amount = normalizeDecimal(get(row, 'amount'));
    const fee = normalizeDecimal(get(row, 'fee'));
    const net = normalizeDecimal(get(row, 'net'));
    const orderId = get(row, 'order') || null;
    const checkoutId = get(row, 'checkout') || null;
    const payoutId = get(row, 'payout id') || null;
    const rawFingerprintType = rawType.toLowerCase().replace(/\s+/g, ' ');
    payments.push({
      source_key: `shopify:${[transactionAt, rawFingerprintType, orderId, amount, fee, net, payoutId].map(fingerprintPart).join('|')}`,
      transaction_at: transactionAt,
      transaction_date: transactionDate,
      event_type: eventType || 'uncategorized',
      order_id: orderId,
      card_brand: get(row, 'card brand') || null,
      card_source: get(row, 'card source') || null,
      payout_status: get(row, 'payout status') || null,
      payout_date: parseDate(get(row, 'payout date')),
      payout_id: payoutId,
      available_on: parseDate(get(row, 'available on')),
      amount,
      fee,
      net,
      checkout_id: checkoutId,
      payment_method_name: get(row, 'payment method name') || null,
      presentment_amount: get(row, 'presentment amount') ? normalizeDecimal(get(row, 'presentment amount')) : null,
      presentment_currency: get(row, 'presentment currency') || null,
      currency: (get(row, 'currency') || get(row, 'presentment currency') || 'USD').toUpperCase(),
      raw_data: rawData,
    });
  });
  if (!payments.length && !reviewRows.length) throw new Error('No payment transaction rows were found in this CSV. Check that it is a Shopify payment transactions export.');
  return { source_kind: 'shopify_payment_transactions', payments, reviewRows };
}

const headerIndex = (headers: string[], names: string[]) => names.map(normalizeHeader).map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
const rowValue = (headers: string[], row: string[], names: string[]) => {
  const index = headerIndex(headers, names);
  return index >= 0 ? row[index]?.trim() || '' : '';
};
const hasHeaders = (headers: string[], names: string[]) => names.every((name) => headers.includes(normalizeHeader(name)));
const hasAnyHeaders = (headers: string[], names: string[]) => headerIndex(headers, names) >= 0;
const parseQuantity = (value: string) => {
  const parsed = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
};
const decimalNumber = (value: string) => Number(normalizeDecimal(value));
const decimalStringFromNumber = (value: number) => Number.isFinite(value) ? value.toFixed(2) : '0.00';
const rawRowData = (headers: string[], row: string[]) => Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() || '']));

export function parseShopifyOrdersCsv(text: string): { source_kind: 'shopify_orders'; orders: ShopifyOrder[]; reviewRows: ImportReviewRow[] } {
  const rows = parseCsvRows(text);
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) throw new Error('The Shopify Orders CSV is empty.');
  const headers = headerRow.map(normalizeHeader);
  const hasOrderName = hasAnyHeaders(headers, ['name', 'order name']);
  const hasOrderDate = hasAnyHeaders(headers, ['created at', 'paid at', 'processed at']);
  const hasOrderTotal = hasAnyHeaders(headers, ['total', 'total sales', 'net sales']);
  if (!hasOrderName || !hasOrderDate || !hasOrderTotal) throw new Error('This CSV is not a Shopify Orders export. Export All orders → All information so the file includes Name, Created at, and Total.');

  const ordersByKey = new Map<string, ShopifyOrder>();
  const reviewRows: ImportReviewRow[] = [];
  let activeKey = '';
  let activeOrder: ShopifyOrder | null = null;
  dataRows.forEach((row, rowIndex) => {
    const rawData = rawRowData(headers, row);
    const explicitName = rowValue(headers, row, ['name', 'order name']);
    const explicitId = rowValue(headers, row, ['id', 'order id']);
    const orderName = explicitName || activeOrder?.order_name || '';
    const orderKey = explicitId || orderName;
    if (!orderKey) {
      reviewRows.push({ row_number: rowIndex + 2, reason: 'Missing Shopify order Name.', raw_data: rawData });
      return;
    }

    if (!activeOrder || activeKey !== orderKey) {
      const rawDate = rowValue(headers, row, ['created at', 'paid at', 'processed at']);
      const orderDate = parseDate(rawDate);
      if (!orderDate) {
        reviewRows.push({ row_number: rowIndex + 2, reason: 'Missing or invalid Shopify order date.', raw_data: rawData });
        activeOrder = null;
        activeKey = orderKey;
        return;
      }
      const currency = (rowValue(headers, row, ['currency', 'order currency']) || 'USD').toUpperCase();
      activeOrder = {
        id: explicitId || undefined,
        source_key: `shopify-order:${fingerprintPart(orderKey)}:${orderDate}:${currency}`,
        order_name: orderName,
        order_date: orderDate,
        financial_status: (rowValue(headers, row, ['financial status']) || 'unknown').toLowerCase(),
        currency,
        gross_sales: normalizeDecimal(rowValue(headers, row, ['gross sales', 'subtotal'])),
        discounts_amount: absoluteDecimal(rowValue(headers, row, ['discount amount', 'discounts'])),
        returns_amount: absoluteDecimal(rowValue(headers, row, ['refunded amount', 'returns', 'sales reversals'])),
        shipping_amount: absoluteDecimal(rowValue(headers, row, ['shipping', 'shipping charges'])),
        taxes_amount: absoluteDecimal(rowValue(headers, row, ['taxes', 'tax'])),
        total_sales: normalizeDecimal(rowValue(headers, row, ['total', 'total sales'])),
        item_quantity: 0,
        line_items: [],
        raw_data: rawData,
      };
      activeKey = orderKey;
      ordersByKey.set(orderKey, activeOrder);
    }

    if (!activeOrder) return;
    const lineSku = rowValue(headers, row, ['lineitem sku', 'line item sku', 'sku']) || null;
    const lineTitle = rowValue(headers, row, ['lineitem name', 'line item name', 'product title']) || null;
    const rawQuantity = rowValue(headers, row, ['lineitem quantity', 'line item quantity', 'quantity']);
    const rawUnitPrice = rowValue(headers, row, ['lineitem price', 'line item price', 'price']);
    const rawLineDiscount = rowValue(headers, row, ['lineitem discount', 'line item discount']);
    if (lineSku || lineTitle || rawQuantity || rawUnitPrice) {
      const quantity = rawQuantity ? parseQuantity(rawQuantity) : 1;
      activeOrder.item_quantity += quantity;
      activeOrder.line_items.push({ sku: lineSku, title: lineTitle, quantity, unit_price: normalizeDecimal(rawUnitPrice), discount: absoluteDecimal(rawLineDiscount) });
    }
  });

  const orders = [...ordersByKey.values()].map((order) => {
    const lineGross = order.line_items.reduce((sum, item) => sum + decimalNumber(item.unit_price) * item.quantity, 0);
    const lineDiscount = order.line_items.reduce((sum, item) => sum + decimalNumber(item.discount), 0);
    const gross = lineGross > 0 ? lineGross : decimalNumber(order.gross_sales) + (decimalNumber(order.discounts_amount) || lineDiscount);
    const discounts = decimalNumber(order.discounts_amount) || lineDiscount;
    const total = decimalNumber(order.total_sales) || Math.max(0, gross - discounts - decimalNumber(order.returns_amount) + decimalNumber(order.shipping_amount) + decimalNumber(order.taxes_amount));
    return { ...order, gross_sales: decimalStringFromNumber(gross), discounts_amount: decimalStringFromNumber(discounts), total_sales: decimalStringFromNumber(total) };
  });
  if (!orders.length && !reviewRows.length) throw new Error('No Shopify order rows were found. Check that you selected the full Orders export.');
  return { source_kind: 'shopify_orders', orders, reviewRows };
}

export function parseShopifyProductsCsv(text: string): { source_kind: 'shopify_products'; products: ShopifyProduct[]; reviewRows: ImportReviewRow[] } {
  const rows = parseCsvRows(text);
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) throw new Error('The Shopify Products CSV is empty.');
  const headers = headerRow.map(normalizeHeader);
  const hasProductIdentity = hasAnyHeaders(headers, ['variant sku', 'sku', 'handle', 'variant id']);
  const hasCost = hasAnyHeaders(headers, ['cost per item', 'variant cost per item', 'cost']);
  if (!hasProductIdentity || !hasCost) throw new Error('This CSV is not a Shopify Products export with costs. Export All products and include Variant SKU plus Cost per item.');

  const products: ShopifyProduct[] = [];
  const reviewRows: ImportReviewRow[] = [];
  let lastTitle = '';
  let lastHandle = '';
  dataRows.forEach((row, rowIndex) => {
    const rawData = rawRowData(headers, row);
    const handle = rowValue(headers, row, ['handle']) || lastHandle;
    const title = rowValue(headers, row, ['title', 'product title']) || lastTitle;
    const sku = rowValue(headers, row, ['variant sku', 'sku']) || null;
    const costRaw = rowValue(headers, row, ['cost per item', 'variant cost per item', 'cost']);
    if (handle) lastHandle = handle;
    if (title) lastTitle = title;
    if (!sku && !handle) { reviewRows.push({ row_number: rowIndex + 2, reason: 'Missing product SKU or Handle.', raw_data: rawData }); return; }
    if (!costRaw || !isDecimalInput(costRaw)) { reviewRows.push({ row_number: rowIndex + 2, reason: 'Missing or invalid Cost per item.', raw_data: rawData }); return; }
    const identity = sku || `${handle}:${rowIndex}`;
    const inventoryRaw = rowValue(headers, row, ['inventory quantity', 'variant inventory qty', 'available', 'on hand (current)']);
    const inventoryQuantity = inventoryRaw && Number.isFinite(Number(inventoryRaw.replace(/,/g, ''))) ? Number(inventoryRaw.replace(/,/g, '')) : null;
    const currency = (rowValue(headers, row, ['currency', 'variant currency']) || 'USD').toUpperCase();
    products.push({ source_key: `shopify-product:${fingerprintPart(identity)}:${normalizeDecimal(costRaw)}`, sku, product_title: title || identity, cost_per_item: absoluteDecimal(costRaw), inventory_quantity: inventoryQuantity, currency, raw_data: rawData });
  });
  if (!products.length && !reviewRows.length) throw new Error('No Shopify product cost rows were found. Check that Cost per item is included in the export.');
  return { source_kind: 'shopify_products', products, reviewRows };
}

export function parseOperatingExpensesCsv(text: string): { source_kind: 'operating_expenses'; expenses: OperatingExpense[]; reviewRows: ImportReviewRow[] } {
  const rows = parseCsvRows(text);
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) throw new Error('The operating expenses CSV is empty.');
  const headers = headerRow.map(normalizeHeader);
  const hasDate = hasAnyHeaders(headers, ['date', 'expense date']);
  const hasAmount = hasAnyHeaders(headers, ['amount', 'expense amount', 'cost']);
  const hasCategory = hasAnyHeaders(headers, ['category', 'expense category']);
  if (!hasDate || !hasAmount || !hasCategory) throw new Error('This CSV is not an operating expenses file. Use Date, Category, Description, Amount, and Currency columns.');

  const expenses: OperatingExpense[] = [];
  const reviewRows: ImportReviewRow[] = [];
  dataRows.forEach((row, rowIndex) => {
    const rawData = rawRowData(headers, row);
    const rawDate = rowValue(headers, row, ['date', 'expense date']);
    const date = parseDate(rawDate);
    const category = rowValue(headers, row, ['category', 'expense category']) || 'Other';
    const description = rowValue(headers, row, ['description', 'name', 'memo']) || category;
    const amountRaw = rowValue(headers, row, ['amount', 'expense amount', 'cost']);
    if (!date) { reviewRows.push({ row_number: rowIndex + 2, reason: 'Missing or invalid expense Date.', raw_data: rawData }); return; }
    if (!amountRaw || !isDecimalInput(amountRaw) || decimalNumber(amountRaw) === 0) { reviewRows.push({ row_number: rowIndex + 2, reason: 'Missing or invalid expense Amount.', raw_data: rawData }); return; }
    const amount = absoluteDecimal(amountRaw);
    const currency = (rowValue(headers, row, ['currency', 'currency code']) || 'USD').toUpperCase();
    expenses.push({ source_key: `operating-expense:${date}:${fingerprintPart(category)}:${fingerprintPart(description)}:${amount}:${currency}`, expense_date: date, category, description, amount, currency, raw_data: rawData });
  });
  if (!expenses.length && !reviewRows.length) throw new Error('No operating expense rows were found. Add one expense per row using the supplied template.');
  return { source_kind: 'operating_expenses', expenses, reviewRows };
}

export function parsePayoutCsv(text: string): { source_kind: 'payouts'; payouts: ImportedPayout[]; reviewRows: ImportReviewRow[] } {
  const rows = parseCsvRows(text);
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) throw new Error('The Shopify payout CSV is empty.');
  const headers = headerRow.map(normalizeHeader);
  if (!hasAnyHeaders(headers, ['payout date', 'date']) || !hasAnyHeaders(headers, ['total', 'payout amount', 'amount', 'net'])) throw new Error('This CSV is not a Shopify payout summary export. Include Payout Date and Total or Amount.');
  const payouts: ImportedPayout[] = [];
  const reviewRows: ImportReviewRow[] = [];
  dataRows.forEach((row, rowIndex) => {
    const rawData = rawRowData(headers, row);
    const payoutDate = parseDate(rowValue(headers, row, ['payout date', 'date']));
    const totalRaw = rowValue(headers, row, ['total', 'payout amount', 'amount', 'net']);
    if (!payoutDate) { reviewRows.push({ row_number: rowIndex + 2, reason: 'Missing or invalid payout date.', raw_data: rawData }); return; }
    if (!totalRaw || !isDecimalInput(totalRaw)) { reviewRows.push({ row_number: rowIndex + 2, reason: 'Missing or invalid payout total.', raw_data: rawData }); return; }
    const currency = (rowValue(headers, row, ['currency', 'payout currency']) || 'USD').toUpperCase();
    const bankReference = rowValue(headers, row, ['payout id', 'bank reference', 'reference']) || '';
    const status = (rowValue(headers, row, ['status', 'payout status']) || 'paid').toLowerCase();
    const charges = absoluteDecimal(rowValue(headers, row, ['charges', 'fees', 'fee']));
    const refunds = absoluteDecimal(rowValue(headers, row, ['refunds', 'refund amount']));
    const adjustments = normalizeDecimal(rowValue(headers, row, ['adjustments', 'adjustment']));
    const taxes = absoluteDecimal(rowValue(headers, row, ['marketplace sales tax', 'taxes', 'tax']));
    payouts.push({ source_key: `payout:${payoutDate}:${fingerprintPart(bankReference)}:${normalizeDecimal(totalRaw)}:${currency}`, payout_date: payoutDate, status, charges, refunds, adjustments, marketplace_sales_tax: taxes, advances: '0.00', reserved_funds: '0.00', fees: charges, retried_amount: '0.00', total: normalizeDecimal(totalRaw), currency, bank_reference: bankReference, raw_data: rawData });
  });
  if (!payouts.length && !reviewRows.length) throw new Error('No payout rows were found.');
  return { source_kind: 'payouts', payouts, reviewRows };
}

function extractPdfRows(items: { str: string; x: number; y: number }[]) {
  const groups: { y: number; items: { str: string; x: number }[] }[] = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    let group = groups.find((candidate) => Math.abs(candidate.y - item.y) < 2);
    if (!group) { group = { y: item.y, items: [] }; groups.push(group); }
    group.items.push({ str: item.str.trim(), x: item.x });
  }
  return groups.sort((a, b) => b.y - a.y).map((group) => group.items.sort((a, b) => a.x - b.x).map((item) => item.str));
}

const numericToken = /^[-()\d,.]+$/;
const currencyToken = /^[-()\d,.]+\s+[A-Z]{3}$/;

export async function parsePayoutPdf(file: File): Promise<ImportedPayout[]> {
  const { GlobalWorkerOptions, getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  GlobalWorkerOptions.workerSrc = pdfWorker;
  const document = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const allItems: { str: string; x: number; y: number }[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ('str' in item) allItems.push({ str: item.str, x: item.transform[4], y: item.transform[5] });
      }
    }
    const rows = extractPdfRows(allItems);
    const records: ImportedPayout[] = [];
    for (const row of rows) {
      const first = row[0]?.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
      if (!first || row.length < 10) continue;
      const totalIndex = row.findIndex((token) => currencyToken.test(token));
      if (totalIndex < 1) continue;
      const [totalRaw, currency] = row[totalIndex].split(/\s+/);
      const numericColumns = row.slice(1, totalIndex).filter((token) => numericToken.test(token));
      if (numericColumns.length < 8) continue;
      const [charges, refunds, adjustments, marketplaceSalesTax, advances, reservedFunds, fees, retriedAmount] = numericColumns.slice(-8).map(normalizeDecimal);
      const bankReference = row[totalIndex + 1] || '';
      const payoutDate = first[1];
      const status = first[2].trim().toLowerCase();
      records.push({
        source_key: `pdf:${payoutDate}:${bankReference}:${normalizeDecimal(totalRaw)}:${status}`,
        payout_date: payoutDate,
        status,
        charges,
        refunds,
        adjustments,
        marketplace_sales_tax: marketplaceSalesTax,
        advances,
        reserved_funds: reservedFunds,
        fees,
        retried_amount: retriedAmount,
        total: normalizeDecimal(totalRaw),
        currency: currency.toUpperCase(),
        bank_reference: bankReference,
        raw_data: { payout_date: payoutDate, status, charges, refunds, adjustments, marketplace_sales_tax: marketplaceSalesTax, advances, reserved_funds: reservedFunds, fees, retried_amount: retriedAmount, total: normalizeDecimal(totalRaw), currency: currency.toUpperCase(), bank_reference: bankReference },
      });
    }
    if (!records.length) throw new Error('No payout rows were found in this PDF. Use a text-based payouts export.');
    return records;
  } finally {
    await document.cleanup();
  }
}

export async function parseImportFile(file: File): Promise<ParsedImport> {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'csv') {
    const text = await file.text();
    const headers = (parseCsvRows(text)[0] || []).map(normalizeHeader);
    if (hasHeaders(headers, ['transaction date', 'type', 'amount', 'fee', 'net'])) {
      const parsed = parsePaymentTransactionsCsv(text);
      return { source_kind: parsed.source_kind, file_type: 'csv', payments: parsed.payments, payouts: [], orders: [], products: [], expenses: [], reviewRows: parsed.reviewRows };
    }
    if (hasAnyHeaders(headers, ['payout date', 'payout id', 'payout status', 'payout amount', 'payout currency']) && hasAnyHeaders(headers, ['payout amount', 'total', 'amount', 'net']) && !hasAnyHeaders(headers, ['lineitem quantity', 'line item quantity']) && !hasAnyHeaders(headers, ['category', 'expense category'])) {
      const parsed = parsePayoutCsv(text);
      return { source_kind: parsed.source_kind, file_type: 'csv', payments: [], payouts: parsed.payouts, orders: [], products: [], expenses: [], reviewRows: parsed.reviewRows };
    }
    if (hasAnyHeaders(headers, ['name', 'order name']) && hasHeaders(headers, ['financial status']) && hasAnyHeaders(headers, ['created at', 'paid at', 'processed at'])) {
      const parsed = parseShopifyOrdersCsv(text);
      return { source_kind: parsed.source_kind, file_type: 'csv', payments: [], payouts: [], orders: parsed.orders, products: [], expenses: [], reviewRows: parsed.reviewRows };
    }
    if (hasAnyHeaders(headers, ['cost per item', 'variant cost per item', 'cost']) && hasAnyHeaders(headers, ['variant sku', 'sku', 'handle', 'variant id'])) {
      const parsed = parseShopifyProductsCsv(text);
      return { source_kind: parsed.source_kind, file_type: 'csv', payments: [], payouts: [], orders: [], products: parsed.products, expenses: [], reviewRows: parsed.reviewRows };
    }
    if (hasAnyHeaders(headers, ['date', 'expense date']) && hasAnyHeaders(headers, ['amount', 'expense amount', 'cost']) && hasAnyHeaders(headers, ['category', 'expense category'])) {
      const parsed = parseOperatingExpensesCsv(text);
      return { source_kind: parsed.source_kind, file_type: 'csv', payments: [], payouts: [], orders: [], products: [], expenses: parsed.expenses, reviewRows: parsed.reviewRows };
    }
    throw new Error(`${file.name} is not a supported Shopify P&L export. Use Orders, Products with Cost per item, Payments transactions, Payout activity, or the Operating expenses template.`);
  }
  if (extension === 'pdf') return { source_kind: 'payouts', file_type: 'pdf', payments: [], payouts: await parsePayoutPdf(file), orders: [], products: [], expenses: [], reviewRows: [] };
  throw new Error(`${file.name} is not supported. Choose a Shopify CSV export or payout activity PDF.`);
}

const decimalCents = (value: string | number | null | undefined) => {
  const normalized = normalizeDecimal(value);
  const negative = normalized.startsWith('-');
  const unsigned = normalized.replace(/^-/, '');
  const [whole = '0', fraction = '00'] = unsigned.split('.');
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2))) * (negative ? -1n : 1n);
};
const absoluteCents = (value: bigint) => value < 0n ? -value : value;
const centsToNumber = (value: bigint) => Number(value) / 100;

export function analyzeImportData(data: Pick<ImportData, 'payments' | 'payouts' | 'orders' | 'products' | 'expenses'>): ImportAnalysis {
  const { payments, payouts, orders, products, expenses } = data;
  const eventMap = new Map<string, { label: string; count: number; cents: bigint }>();
  const statusMap = new Map<string, { label: string; count: number; cents: bigint }>();
  const monthMap = new Map<string, { month: string; records: number; grossCents: bigint; netCents: bigint; feesCents: bigint }>();
  const orderMap = new Map<string, { label: string; count: number; cents: bigint }>();
  const paymentByPayoutId = new Map<string, bigint>();
  const paymentByPayoutDate = new Map<string, bigint>();
  let grossCents = 0n; let paymentFeesCents = 0n; let paymentNetCents = 0n; let refundsCents = 0n; let chargebacksCents = 0n; let marketplaceSalesTaxCents = 0n; let positivePaymentNetCents = 0n; let negativePaymentNetCents = 0n;
  const dates = [...payments.map((item) => item.transaction_date), ...payouts.map((item) => item.payout_date), ...orders.map((item) => item.order_date), ...expenses.map((item) => item.expense_date)].filter(Boolean).sort();

  for (const payment of payments) {
    const amountCents = decimalCents(payment.amount); const feeCents = absoluteCents(decimalCents(payment.fee)); const netCents = decimalCents(payment.net);
    if (payment.event_type === 'charge') grossCents += absoluteCents(amountCents);
    if (payment.event_type === 'refund') refundsCents += absoluteCents(amountCents);
    if (payment.event_type === 'chargeback') chargebacksCents += absoluteCents(amountCents);
    if (payment.event_type === 'marketplace sales tax') marketplaceSalesTaxCents += absoluteCents(amountCents);
    paymentFeesCents += feeCents; paymentNetCents += netCents;
    if (payment.payout_id) paymentByPayoutId.set(payment.payout_id, (paymentByPayoutId.get(payment.payout_id) || 0n) + netCents);
    if (payment.payout_date) paymentByPayoutDate.set(payment.payout_date, (paymentByPayoutDate.get(payment.payout_date) || 0n) + netCents);
    if (netCents >= 0n) positivePaymentNetCents += netCents; else negativePaymentNetCents += absoluteCents(netCents);

    const event = eventMap.get(payment.event_type) || { label: payment.event_type, count: 0, cents: 0n }; event.count += 1; event.cents += absoluteCents(amountCents); eventMap.set(payment.event_type, event);
    const statusLabel = payment.payout_status || 'unknown'; const status = statusMap.get(statusLabel) || { label: statusLabel, count: 0, cents: 0n }; status.count += 1; status.cents += absoluteCents(amountCents); statusMap.set(statusLabel, status);
    const month = payment.transaction_date.slice(0, 7); const trend = monthMap.get(month) || { month, records: 0, grossCents: 0n, netCents: 0n, feesCents: 0n }; trend.records += 1; trend.grossCents += payment.event_type === 'charge' ? absoluteCents(amountCents) : 0n; trend.netCents += netCents; trend.feesCents += feeCents; monthMap.set(month, trend);
    if (payment.order_id) { const order = orderMap.get(payment.order_id) || { label: payment.order_id, count: 0, cents: 0n }; order.count += 1; order.cents += netCents; orderMap.set(payment.order_id, order); }
  }

  const productCostBySku = new Map(products.filter((item) => item.sku).map((item) => [item.sku!.trim().toLowerCase(), item.cost_per_item]));
  let grossSalesCents = 0n; let discountsCents = 0n; let returnsAmountCents = 0n; let shippingRevenueCents = 0n; let taxesCollectedCents = 0n; let cogsCents = 0n; let cogsMatchedUnits = 0; let cogsUnmatchedUnits = 0;
  for (const order of orders) {
    grossSalesCents += absoluteCents(decimalCents(order.gross_sales));
    discountsCents += absoluteCents(decimalCents(order.discounts_amount));
    returnsAmountCents += absoluteCents(decimalCents(order.returns_amount));
    shippingRevenueCents += decimalCents(order.shipping_amount);
    taxesCollectedCents += decimalCents(order.taxes_amount);
    for (const line of order.line_items) {
      const quantity = Math.max(0, line.quantity);
      const cost = line.sku ? productCostBySku.get(line.sku.trim().toLowerCase()) : undefined;
      if (cost === undefined) cogsUnmatchedUnits += quantity;
      else { cogsCents += decimalCents(cost) * BigInt(quantity); cogsMatchedUnits += quantity; }
    }
  }
  const operatingExpensesCents = expenses.reduce((sum, item) => sum + absoluteCents(decimalCents(item.amount)), 0n);
  const netSalesCents = grossSalesCents - discountsCents - returnsAmountCents;
  const estimatedOperatingProfitCents = netSalesCents + shippingRevenueCents - cogsCents - paymentFeesCents - operatingExpensesCents;
  const pnlMissingExports = [
    orders.length ? '' : 'Orders export',
    products.length ? '' : 'Products + cost export',
    payments.length ? '' : 'Payments transactions',
    payouts.length ? '' : 'Payout activity',
    expenses.length ? '' : 'Operating expenses',
  ].filter(Boolean);

  const payoutTotalCents = payouts.reduce((sum, item) => sum + decimalCents(item.total), 0n);
  const payoutFeesCents = payouts.reduce((sum, item) => sum + absoluteCents(decimalCents(item.fees)), 0n);
  const payoutRefundsCents = payouts.reduce((sum, item) => sum + absoluteCents(decimalCents(item.refunds)), 0n);
  const payoutAdjustmentsCents = payouts.reduce((sum, item) => sum + decimalCents(item.adjustments), 0n);
  const payoutTaxesCents = payouts.reduce((sum, item) => sum + decimalCents(item.marketplace_sales_tax), 0n);

  let reconciledPayouts = 0; let balancedPayouts = 0; let unmatchedPayouts = 0; let matchedCsvNetCents = 0n; let usedPayoutIdMatch = false; let usedPayoutDateMatch = false;
  for (const payout of payouts) {
    const bankReference = payout.bank_reference.trim();
    const idNetCents = bankReference ? paymentByPayoutId.get(bankReference) : undefined;
    const dateNetCents = paymentByPayoutDate.get(payout.payout_date);
    const matchedNetCents = idNetCents !== undefined ? idNetCents : dateNetCents;
    if (matchedNetCents === undefined) { unmatchedPayouts += 1; continue; }
    reconciledPayouts += 1; matchedCsvNetCents += matchedNetCents;
    if (idNetCents !== undefined) usedPayoutIdMatch = true; else usedPayoutDateMatch = true;
    if (absoluteCents(decimalCents(payout.total) - matchedNetCents) < 1n) balancedPayouts += 1;
  }
  const reconciliationMatchMode: ImportAnalysis['reconciliationMatchMode'] = usedPayoutIdMatch ? 'payout_id' : usedPayoutDateMatch ? 'payout_date' : 'none';

  return {
    paymentRows: payments.length,
    payoutRows: payouts.length,
    orderRows: orders.length,
    productRows: products.length,
    expenseRows: expenses.length,
    totalRows: payments.length + payouts.length + orders.length + products.length + expenses.length,
    grossVolume: centsToNumber(grossCents),
    paymentFees: centsToNumber(paymentFeesCents),
    paymentNet: centsToNumber(paymentNetCents),
    refundsTotal: centsToNumber(refundsCents),
    chargebacksTotal: centsToNumber(chargebacksCents),
    marketplaceSalesTaxTotal: centsToNumber(marketplaceSalesTaxCents),
    netTransactionMovement: centsToNumber(paymentNetCents),
    positivePaymentNet: centsToNumber(positivePaymentNetCents),
    negativePaymentNet: centsToNumber(negativePaymentNetCents),
    payoutTotal: centsToNumber(payoutTotalCents),
    payoutFees: centsToNumber(payoutFeesCents),
    payoutRefunds: centsToNumber(payoutRefundsCents),
    payoutAdjustments: centsToNumber(payoutAdjustmentsCents),
    payoutTaxes: centsToNumber(payoutTaxesCents),
    reconciliationDifference: payouts.length ? centsToNumber(payoutTotalCents - matchedCsvNetCents) : 0,
    reconciledPayouts,
    balancedPayouts,
    unmatchedPayouts,
    reconciliationMatchMode,
    uniqueOrders: orderMap.size,
    paidRows: payments.filter((item) => item.payout_status === 'paid').length,
    pendingRows: payments.filter((item) => item.payout_status === 'pending').length,
    dateFrom: dates[0] || null,
    dateTo: dates[dates.length - 1] || null,
    currency: payments[0]?.currency || payouts[0]?.currency || orders[0]?.currency || products[0]?.currency || expenses[0]?.currency || 'USD',
    eventBreakdown: [...eventMap.values()].map((item) => ({ label: item.label, count: item.count, amount: centsToNumber(item.cents) })).sort((a, b) => b.amount - a.amount),
    statusBreakdown: [...statusMap.values()].map((item) => ({ label: item.label, count: item.count, amount: centsToNumber(item.cents) })).sort((a, b) => b.count - a.count),
    monthlyTrend: [...monthMap.values()].map((item) => ({ month: item.month, records: item.records, gross: centsToNumber(item.grossCents), net: centsToNumber(item.netCents), fees: centsToNumber(item.feesCents) })).sort((a, b) => a.month.localeCompare(b.month)),
    topOrders: [...orderMap.values()].map((item) => ({ label: item.label, count: item.count, amount: centsToNumber(item.cents) })).sort((a, b) => b.amount - a.amount).slice(0, 8),
    grossSales: centsToNumber(grossSalesCents),
    discountsAmount: centsToNumber(discountsCents),
    returnsAmount: centsToNumber(returnsAmountCents),
    netSales: centsToNumber(netSalesCents),
    shippingRevenue: centsToNumber(shippingRevenueCents),
    taxesCollected: centsToNumber(taxesCollectedCents),
    cogs: centsToNumber(cogsCents),
    cogsMatchedUnits,
    cogsUnmatchedUnits,
    operatingExpenses: centsToNumber(operatingExpensesCents),
    estimatedOperatingProfit: centsToNumber(estimatedOperatingProfitCents),
    pnlReady: pnlMissingExports.length === 0,
    pnlMissingExports,
  };
}

export async function loadImportData(userId: string): Promise<ImportData> {
  if (!supabase) return emptyImportData;
  const [batches, payments, payouts, orders, products, expenses] = await Promise.all([
    supabase.from('finance_import_batches').select('id,user_id,file_name,file_type,source_kind,file_size,row_count,imported_count,duplicate_count,review_count,total_amount,total_fee,total_net,currency_code,status,imported_at').eq('user_id', userId).order('imported_at', { ascending: false }).limit(20),
    supabase.from('finance_payment_imports').select('id,batch_id,source_key,transaction_at,transaction_date,event_type,order_id,card_brand,card_source,payout_status,payout_date,payout_id,available_on,amount,fee,net,checkout_id,payment_method_name,presentment_amount,presentment_currency,currency').eq('user_id', userId).order('transaction_at', { ascending: false }).limit(2000),
    supabase.from('finance_payouts').select('id,batch_id,source_key,payout_date,status,charges,refunds,adjustments,marketplace_sales_tax,advances,reserved_funds,fees,retried_amount,total,currency,bank_reference').eq('user_id', userId).order('payout_date', { ascending: false }).limit(500),
    supabase.from('finance_shopify_orders').select('id,batch_id,source_key,order_name,order_date,financial_status,currency_code,gross_sales,discounts_amount,returns_amount,shipping_amount,taxes_amount,total_sales,item_quantity,line_items').eq('user_id', userId).order('order_date', { ascending: false }).limit(2000),
    supabase.from('finance_shopify_products').select('id,batch_id,source_key,sku,product_title,cost_per_item,inventory_quantity,currency_code').eq('user_id', userId).order('product_title', { ascending: true }).limit(100000),
    supabase.from('finance_operating_expenses').select('id,batch_id,source_key,expense_date,category,description,amount,currency_code').eq('user_id', userId).order('expense_date', { ascending: false }).limit(2000),
  ]);
  const error = [batches, payments, payouts, orders, products, expenses].find((result) => result.error)?.error;
  if (error) throw error;
  return {
    batches: (batches.data ?? []) as FinanceImportBatch[],
    payments: (payments.data ?? []).map((item) => ({ ...item, raw_data: {} })) as ImportedPayment[],
    payouts: (payouts.data ?? []).map((item) => ({ ...item, raw_data: {} })) as ImportedPayout[],
    orders: (orders.data ?? []).map((item) => ({
      ...(item as Omit<ShopifyOrder, 'currency'> & { currency_code: string }),
      currency: (item.currency_code || 'USD').toUpperCase(),
      raw_data: {},
    })) as ShopifyOrder[],
    products: (products.data ?? []).map((item) => ({
      ...(item as Omit<ShopifyProduct, 'currency'> & { currency_code: string }),
      currency: (item.currency_code || 'USD').toUpperCase(),
      raw_data: {},
    })) as ShopifyProduct[],
    expenses: (expenses.data ?? []).map((item) => ({
      ...(item as Omit<OperatingExpense, 'currency'> & { currency_code: string }),
      currency: (item.currency_code || 'USD').toUpperCase(),
      raw_data: {},
    })) as OperatingExpense[],
  };
}

export async function deleteImportedBatch(userId: string, batchId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');

  const transactionsResult = await supabase
    .from('finance_transactions')
    .select('id')
    .eq('user_id', userId)
    .eq('import_batch_id', batchId);
  if (transactionsResult.error) throw transactionsResult.error;

  const transactionIds = (transactionsResult.data ?? []).map((row) => row.id as string);
  if (transactionIds.length) {
    const splitResult = await supabase
      .from('finance_splits')
      .update({ transaction_id: null })
      .eq('user_id', userId)
      .in('transaction_id', transactionIds);
    if (splitResult.error) throw splitResult.error;

    const tagsResult = await supabase
      .from('finance_transaction_tags')
      .delete()
      .eq('user_id', userId)
      .in('transaction_id', transactionIds);
    if (tagsResult.error) throw tagsResult.error;

    const transactionsDeleteResult = await supabase
      .from('finance_transactions')
      .delete()
      .eq('user_id', userId)
      .eq('import_batch_id', batchId);
    if (transactionsDeleteResult.error) throw transactionsDeleteResult.error;
  }

  const [paymentsResult, payoutsResult, ordersResult, productsResult, expensesResult] = await Promise.all([
    supabase.from('finance_payment_imports').delete().eq('user_id', userId).eq('batch_id', batchId),
    supabase.from('finance_payouts').delete().eq('user_id', userId).eq('batch_id', batchId),
    supabase.from('finance_shopify_orders').delete().eq('user_id', userId).eq('batch_id', batchId),
    supabase.from('finance_shopify_products').delete().eq('user_id', userId).eq('batch_id', batchId),
    supabase.from('finance_operating_expenses').delete().eq('user_id', userId).eq('batch_id', batchId),
  ]);
  if (paymentsResult.error) throw paymentsResult.error;
  if (payoutsResult.error) throw payoutsResult.error;
  if (ordersResult.error) throw ordersResult.error;
  if (productsResult.error) throw productsResult.error;
  if (expensesResult.error) throw expensesResult.error;

  const batchResult = await supabase
    .from('finance_import_batches')
    .delete()
    .eq('user_id', userId)
    .eq('id', batchId);
  if (batchResult.error) throw batchResult.error;
}

async function ensureImportAccount(userId: string, currencyCode = 'USD') {
  if (!supabase) throw new Error('Supabase is not configured.');
  const name = 'Imported payment activity';
  const existing = await supabase.from('finance_accounts').select('id').eq('user_id', userId).eq('name', name).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id as string;
  const created = await supabase.from('finance_accounts').insert({ user_id: userId, name, account_type: 'bank', institution: 'Payment processor exports', currency_code: currencyCode, opening_balance: '0.00', current_balance: '0.00' }).select('id').single();
  if (created.error) throw created.error;
  return created.data.id as string;
}

async function ensureImportCategory(userId: string, name: string, kind: 'income' | 'expense', color: string, icon: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const existing = await supabase.from('finance_categories').select('id').eq('user_id', userId).eq('name', name).eq('kind', kind).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id as string;
  const created = await supabase.from('finance_categories').insert({ user_id: userId, name, kind, color, icon }).select('id').single();
  if (created.error) throw created.error;
  return created.data.id as string;
}

const chunk = <T,>(items: T[], size = 250) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

// Let Postgres perform duplicate detection through the existing
// (user_id, source_key) unique indexes. This avoids one URL-filter request per
// small group of source keys, which becomes prohibitively slow for large
// Shopify product exports.
const IMPORT_INSERT_CHUNK_SIZE = 1000;
type DedupeImportTable = 'finance_payment_imports' | 'finance_payouts' | 'finance_shopify_orders' | 'finance_shopify_products' | 'finance_operating_expenses';
async function insertImportRows(client: NonNullable<typeof supabase>, table: DedupeImportTable, rows: Record<string, unknown>[]) {
  const insertedKeys = new Set<string>();
  for (const part of chunk(rows, IMPORT_INSERT_CHUNK_SIZE)) {
    const response = await client
      .from(table)
      .upsert(part, { onConflict: 'user_id,source_key', ignoreDuplicates: true })
      .select('source_key');
    if (response.error) throw response.error;
    for (const row of response.data ?? []) insertedKeys.add(row.source_key as string);
  }
  return insertedKeys;
}

export async function persistParsedImport(userId: string, file: File, parsed: ParsedImport) {
  const client = supabase;
  if (!client) throw new Error('Connect Supabase before importing persistent data.');
  const analysis = analyzeImportData(parsed);
  const batchTotals = parsed.source_kind === 'shopify_orders'
    ? { total_amount: analysis.grossSales, total_fee: 0, total_net: analysis.netSales }
    : parsed.source_kind === 'shopify_products'
      ? { total_amount: 0, total_fee: 0, total_net: 0 }
      : parsed.source_kind === 'operating_expenses'
        ? { total_amount: analysis.operatingExpenses, total_fee: 0, total_net: -analysis.operatingExpenses }
        : parsed.source_kind === 'payouts'
          ? { total_amount: analysis.payoutTotal, total_fee: analysis.payoutFees, total_net: analysis.payoutTotal }
          : { total_amount: analysis.grossVolume, total_fee: analysis.paymentFees, total_net: analysis.paymentNet };
  const batchResult = await client.from('finance_import_batches').insert({ user_id: userId, file_name: file.name, file_type: parsed.file_type, source_kind: parsed.source_kind, file_size: file.size, row_count: analysis.totalRows + parsed.reviewRows.length, imported_count: 0, duplicate_count: 0, review_count: parsed.reviewRows.length, ...batchTotals, currency_code: analysis.currency, status: 'processing', metadata: { imported_from: 'GCS Books import center', review_rows: parsed.reviewRows } }).select('*').single();
  if (batchResult.error || !batchResult.data) throw batchResult.error || new Error('Could not create the import batch.');
  const batch = batchResult.data as FinanceImportBatch;
  const finishBatch = async (importedCount: number, duplicateCount: number, importedCounts: { importedPayments: number; importedPayouts: number; importedOrders: number; importedProducts: number; importedExpenses: number }) => {
    const completedBatch = await client.from('finance_import_batches').update({ imported_count: importedCount, duplicate_count: duplicateCount, review_count: parsed.reviewRows.length, status: 'completed' }).eq('id', batch.id).eq('user_id', userId);
    if (completedBatch.error) throw completedBatch.error;
    return { batch: { ...batch, imported_count: importedCount, duplicate_count: duplicateCount, review_count: parsed.reviewRows.length, status: 'completed' as const }, ...importedCounts, duplicateCount, reviewCount: parsed.reviewRows.length };
  };
  try {
    if (parsed.source_kind === 'shopify_orders') {
      const rows = parsed.orders.map((item) => ({
        user_id: userId,
        batch_id: batch.id,
        source_key: item.source_key,
        order_name: item.order_name,
        order_date: item.order_date,
        financial_status: item.financial_status,
        currency_code: item.currency,
        gross_sales: item.gross_sales,
        discounts_amount: item.discounts_amount,
        returns_amount: item.returns_amount,
        shipping_amount: item.shipping_amount,
        taxes_amount: item.taxes_amount,
        total_sales: item.total_sales,
        item_quantity: item.item_quantity,
        line_items: item.line_items,
        raw_data: item.raw_data,
      }));
      const insertedKeys = await insertImportRows(client, 'finance_shopify_orders', rows);
      return finishBatch(insertedKeys.size, parsed.orders.length - insertedKeys.size, { importedPayments: 0, importedPayouts: 0, importedOrders: insertedKeys.size, importedProducts: 0, importedExpenses: 0 });
    }
    if (parsed.source_kind === 'shopify_products') {
      const rows = parsed.products.map((item) => ({
        user_id: userId,
        batch_id: batch.id,
        source_key: item.source_key,
        sku: item.sku,
        product_title: item.product_title,
        cost_per_item: item.cost_per_item,
        inventory_quantity: item.inventory_quantity,
        currency_code: item.currency,
        raw_data: item.raw_data,
      }));
      const insertedKeys = await insertImportRows(client, 'finance_shopify_products', rows);
      return finishBatch(insertedKeys.size, parsed.products.length - insertedKeys.size, { importedPayments: 0, importedPayouts: 0, importedOrders: 0, importedProducts: insertedKeys.size, importedExpenses: 0 });
    }
    if (parsed.source_kind === 'operating_expenses') {
      const rows = parsed.expenses.map((item) => ({
        user_id: userId,
        batch_id: batch.id,
        source_key: item.source_key,
        expense_date: item.expense_date,
        category: item.category,
        description: item.description,
        amount: item.amount,
        currency_code: item.currency,
        raw_data: item.raw_data,
      }));
      const insertedKeys = await insertImportRows(client, 'finance_operating_expenses', rows);
      return finishBatch(insertedKeys.size, parsed.expenses.length - insertedKeys.size, { importedPayments: 0, importedPayouts: 0, importedOrders: 0, importedProducts: 0, importedExpenses: insertedKeys.size });
    }
    if (parsed.source_kind === 'shopify_payment_transactions' || parsed.source_kind === 'payment_transactions') {
      const rows = parsed.payments.map((item) => ({ ...item, user_id: userId, batch_id: batch.id }));
      const insertedKeys = await insertImportRows(client, 'finance_payment_imports', rows);
      const fresh = parsed.payments.filter((item) => insertedKeys.has(item.source_key));
      if (fresh.length) {
        const accountId = await ensureImportAccount(userId, parsed.payments[0]?.currency || analysis.currency || 'USD');
        const incomeCategoryId = await ensureImportCategory(userId, 'Payment revenue', 'income', '#82d84c', '↙');
        const expenseCategoryId = await ensureImportCategory(userId, 'Refunds & adjustments', 'expense', '#e5a15a', '↗');
        const transactions = fresh.filter((item) => positiveAmount(item.net, item.amount) !== '0.00').map((item) => {
          const expense = isNegative(item.net) || isNegative(item.amount) || /refund|chargeback|tax|adjustment/.test(item.event_type);
          return { user_id: userId, account_id: accountId, category_id: expense ? expenseCategoryId : incomeCategoryId, type: expense ? 'expense' : 'income', amount: positiveAmount(item.net, item.amount), currency_code: item.currency, transaction_date: item.transaction_date, merchant: item.payment_method_name || item.event_type, description: `${item.event_type}${item.order_id ? ` · ${item.order_id}` : ''}`, notes: `Imported from ${file.name}`, tags: ['imported', item.event_type], is_recurring: false, import_batch_id: batch.id, external_source_key: `payment:${item.source_key}` };
        });
        for (const part of chunk(transactions)) { const response = await client.from('finance_transactions').upsert(part, { onConflict: 'user_id,external_source_key', ignoreDuplicates: true }); if (response.error) throw response.error; }
      }
      return finishBatch(insertedKeys.size, parsed.payments.length - insertedKeys.size, { importedPayments: insertedKeys.size, importedPayouts: 0, importedOrders: 0, importedProducts: 0, importedExpenses: 0 });
    }
    const rows = parsed.payouts.map((item) => ({ ...item, user_id: userId, batch_id: batch.id }));
    const insertedKeys = await insertImportRows(client, 'finance_payouts', rows);
    return finishBatch(insertedKeys.size, parsed.payouts.length - insertedKeys.size, { importedPayments: 0, importedPayouts: insertedKeys.size, importedOrders: 0, importedProducts: 0, importedExpenses: 0 });
  } catch (error) {
    await Promise.all([
      client.from('finance_payment_imports').delete().eq('user_id', userId).eq('batch_id', batch.id),
      client.from('finance_payouts').delete().eq('user_id', userId).eq('batch_id', batch.id),
      client.from('finance_shopify_orders').delete().eq('user_id', userId).eq('batch_id', batch.id),
      client.from('finance_shopify_products').delete().eq('user_id', userId).eq('batch_id', batch.id),
      client.from('finance_operating_expenses').delete().eq('user_id', userId).eq('batch_id', batch.id),
      client.from('finance_transactions').delete().eq('user_id', userId).eq('import_batch_id', batch.id),
    ]);
    await client.from('finance_import_batches').update({ status: 'failed' }).eq('id', batch.id).eq('user_id', userId);
    throw error;
  }
}
