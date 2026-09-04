import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from './supabase';

GlobalWorkerOptions.workerSrc = pdfWorker;

export type ImportSourceKind = 'payment_transactions' | 'payouts';

export type ImportedPayment = {
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
  total_amount: number | string;
  total_fee: number | string;
  total_net: number | string;
  currency_code: string;
  status: 'processing' | 'completed' | 'failed';
  imported_at: string;
};

export type ImportData = {
  batches: FinanceImportBatch[];
  payments: ImportedPayment[];
  payouts: ImportedPayout[];
};

export type ParsedImport = {
  source_kind: ImportSourceKind;
  file_type: 'csv' | 'pdf';
  payments: ImportedPayment[];
  payouts: ImportedPayout[];
};

export type ImportBreakdown = { label: string; count: number; amount: number };
export type ImportMonthlyTrend = { month: string; records: number; gross: number; net: number; fees: number };
export type ImportAnalysis = {
  paymentRows: number;
  payoutRows: number;
  totalRows: number;
  grossVolume: number;
  paymentFees: number;
  paymentNet: number;
  positivePaymentNet: number;
  negativePaymentNet: number;
  payoutTotal: number;
  payoutFees: number;
  payoutRefunds: number;
  payoutAdjustments: number;
  payoutTaxes: number;
  reconciliationDifference: number;
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
};

export const emptyImportData: ImportData = { batches: [], payments: [], payouts: [] };

const normalizeHeader = (value: string) => value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, ' ');

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
const numberValue = (value: string | number | null | undefined) => Number(value ?? 0);
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
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? `${value.slice(0, 10)}T00:00:00.000Z` : parsed.toISOString();
};

export function parsePaymentTransactionsCsv(text: string): ImportedPayment[] {
  const rows = parseCsvRows(text);
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) throw new Error('The CSV file is empty.');
  const headers = headerRow.map(normalizeHeader);
  const indexOf = (name: string) => headers.indexOf(normalizeHeader(name));
  const get = (row: string[], name: string) => { const index = indexOf(name); return index >= 0 ? row[index]?.trim() || '' : ''; };
  const required = ['transaction date', 'type', 'amount', 'fee', 'net', 'currency'];
  const missing = required.filter((name) => indexOf(name) < 0);
  if (missing.length) throw new Error(`This CSV is missing required columns: ${missing.join(', ')}.`);

  return dataRows.map((row, rowIndex) => {
    const transactionAt = parseDateTime(get(row, 'transaction date'));
    const transactionDate = transactionAt.slice(0, 10);
    const eventType = get(row, 'type').toLowerCase() || 'other';
    const amount = normalizeDecimal(get(row, 'amount'));
    const fee = normalizeDecimal(get(row, 'fee'));
    const net = normalizeDecimal(get(row, 'net'));
    const rawData = Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() || '']));
    return {
      source_key: `csv:${rowIndex}:${transactionAt}:${eventType}:${get(row, 'order')}:${get(row, 'checkout')}:${amount}:${fee}:${net}`,
      transaction_at: transactionAt,
      transaction_date: transactionDate,
      event_type: eventType,
      order_id: get(row, 'order') || null,
      card_brand: get(row, 'card brand') || null,
      card_source: get(row, 'card source') || null,
      payout_status: get(row, 'payout status') || null,
      payout_date: parseDate(get(row, 'payout date')),
      payout_id: get(row, 'payout id') || null,
      available_on: parseDate(get(row, 'available on')),
      amount,
      fee,
      net,
      checkout_id: get(row, 'checkout') || null,
      payment_method_name: get(row, 'payment method name') || null,
      presentment_amount: get(row, 'presentment amount') ? normalizeDecimal(get(row, 'presentment amount')) : null,
      presentment_currency: get(row, 'presentment currency') || null,
      currency: get(row, 'currency').toUpperCase() || 'USD',
      raw_data: rawData,
    };
  });
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
  const document = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
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
}

export async function parseImportFile(file: File): Promise<ParsedImport> {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'csv') return { source_kind: 'payment_transactions', file_type: 'csv', payments: parsePaymentTransactionsCsv(await file.text()), payouts: [] };
  if (extension === 'pdf') return { source_kind: 'payouts', file_type: 'pdf', payments: [], payouts: await parsePayoutPdf(file) };
  throw new Error(`${file.name} is not supported. Choose a CSV or PDF export.`);
}

export function analyzeImportData(data: Pick<ImportData, 'payments' | 'payouts'>): ImportAnalysis {
  const { payments, payouts } = data;
  const eventMap = new Map<string, ImportBreakdown>();
  const statusMap = new Map<string, ImportBreakdown>();
  const monthMap = new Map<string, ImportMonthlyTrend>();
  const orderMap = new Map<string, ImportBreakdown>();
  let grossVolume = 0; let paymentFees = 0; let paymentNet = 0; let positivePaymentNet = 0; let negativePaymentNet = 0;
  const dates = [...payments.map((item) => item.transaction_date), ...payouts.map((item) => item.payout_date)].filter(Boolean).sort();
  for (const payment of payments) {
    const amount = numberValue(payment.amount); const fee = Math.abs(numberValue(payment.fee)); const net = numberValue(payment.net);
    grossVolume += Math.abs(amount); paymentFees += fee; paymentNet += net;
    if (net >= 0) positivePaymentNet += net; else negativePaymentNet += Math.abs(net);
    const event = eventMap.get(payment.event_type) || { label: payment.event_type, count: 0, amount: 0 }; event.count += 1; event.amount += Math.abs(net || amount); eventMap.set(payment.event_type, event);
    const statusLabel = payment.payout_status || 'unknown'; const status = statusMap.get(statusLabel) || { label: statusLabel, count: 0, amount: 0 }; status.count += 1; status.amount += Math.abs(net || amount); statusMap.set(statusLabel, status);
    const month = payment.transaction_date.slice(0, 7); const trend = monthMap.get(month) || { month, records: 0, gross: 0, net: 0, fees: 0 }; trend.records += 1; trend.gross += Math.abs(amount); trend.net += net; trend.fees += fee; monthMap.set(month, trend);
    if (payment.order_id) { const order = orderMap.get(payment.order_id) || { label: payment.order_id, count: 0, amount: 0 }; order.count += 1; order.amount += net; orderMap.set(payment.order_id, order); }
  }
  const payoutTotal = payouts.reduce((sum, item) => sum + numberValue(item.total), 0);
  const payoutFees = payouts.reduce((sum, item) => sum + Math.abs(numberValue(item.fees)), 0);
  const payoutRefunds = payouts.reduce((sum, item) => sum + Math.abs(numberValue(item.refunds)), 0);
  const payoutAdjustments = payouts.reduce((sum, item) => sum + numberValue(item.adjustments), 0);
  const payoutTaxes = payouts.reduce((sum, item) => sum + numberValue(item.marketplace_sales_tax), 0);
  return {
    paymentRows: payments.length, payoutRows: payouts.length, totalRows: payments.length + payouts.length, grossVolume, paymentFees, paymentNet, positivePaymentNet, negativePaymentNet, payoutTotal, payoutFees, payoutRefunds, payoutAdjustments, payoutTaxes, reconciliationDifference: payoutTotal - paymentNet, uniqueOrders: orderMap.size, paidRows: payments.filter((item) => item.payout_status === 'paid').length, pendingRows: payments.filter((item) => item.payout_status === 'pending').length, dateFrom: dates[0] || null, dateTo: dates[dates.length - 1] || null, currency: payments[0]?.currency || payouts[0]?.currency || 'USD', eventBreakdown: [...eventMap.values()].sort((a, b) => b.amount - a.amount), statusBreakdown: [...statusMap.values()].sort((a, b) => b.count - a.count), monthlyTrend: [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)), topOrders: [...orderMap.values()].sort((a, b) => b.amount - a.amount).slice(0, 8),
  };
}

export async function loadImportData(userId: string): Promise<ImportData> {
  if (!supabase) return emptyImportData;
  const [batches, payments, payouts] = await Promise.all([
    supabase.from('finance_import_batches').select('*').eq('user_id', userId).order('imported_at', { ascending: false }).limit(20),
    supabase.from('finance_payment_imports').select('*').eq('user_id', userId).order('transaction_at', { ascending: false }).limit(2000),
    supabase.from('finance_payouts').select('*').eq('user_id', userId).order('payout_date', { ascending: false }).limit(500),
  ]);
  const error = [batches, payments, payouts].find((result) => result.error)?.error;
  if (error) throw error;
  return { batches: (batches.data ?? []) as FinanceImportBatch[], payments: (payments.data ?? []) as ImportedPayment[], payouts: (payouts.data ?? []) as ImportedPayout[] };
}

async function ensureImportAccount(userId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const name = 'Imported payment activity';
  const existing = await supabase.from('finance_accounts').select('id').eq('user_id', userId).eq('name', name).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id as string;
  const created = await supabase.from('finance_accounts').insert({ user_id: userId, name, account_type: 'bank', institution: 'Payment processor exports', currency_code: 'USD', opening_balance: '0.00', current_balance: '0.00' }).select('id').single();
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

export async function persistParsedImport(userId: string, file: File, parsed: ParsedImport) {
  if (!supabase) throw new Error('Connect Supabase before importing persistent data.');
  const analysis = analyzeImportData(parsed);
  const batchResult = await supabase.from('finance_import_batches').insert({ user_id: userId, file_name: file.name, file_type: parsed.file_type, source_kind: parsed.source_kind, file_size: file.size, row_count: analysis.totalRows, imported_count: 0, duplicate_count: 0, total_amount: parsed.source_kind === 'payment_transactions' ? analysis.grossVolume : analysis.payoutTotal, total_fee: parsed.source_kind === 'payment_transactions' ? analysis.paymentFees : analysis.payoutFees, total_net: parsed.source_kind === 'payment_transactions' ? analysis.paymentNet : analysis.payoutTotal, currency_code: analysis.currency, status: 'processing', metadata: { imported_from: 'GCS Books import center' } }).select('*').single();
  if (batchResult.error || !batchResult.data) throw batchResult.error || new Error('Could not create the import batch.');
  const batch = batchResult.data as FinanceImportBatch;
  try {
    if (parsed.source_kind === 'payment_transactions') {
      const keys = parsed.payments.map((item) => item.source_key);
      const existing = keys.length ? await supabase.from('finance_payment_imports').select('source_key').eq('user_id', userId).in('source_key', keys) : { data: [], error: null };
      if (existing.error) throw existing.error;
      const existingKeys = new Set((existing.data ?? []).map((item) => item.source_key));
      const fresh = parsed.payments.filter((item) => !existingKeys.has(item.source_key));
      for (const part of chunk(fresh)) { const response = await supabase.from('finance_payment_imports').insert(part.map((item) => ({ ...item, user_id: userId, batch_id: batch.id }))); if (response.error) throw response.error; }
      if (fresh.length) {
        const accountId = await ensureImportAccount(userId);
        const incomeCategoryId = await ensureImportCategory(userId, 'Payment revenue', 'income', '#82d84c', '↙');
        const expenseCategoryId = await ensureImportCategory(userId, 'Refunds & adjustments', 'expense', '#e5a15a', '↗');
        const transactions = fresh.filter((item) => positiveAmount(item.net, item.amount) !== '0.00').map((item) => {
          const expense = isNegative(item.net) || isNegative(item.amount) || /refund|chargeback|tax|adjustment/.test(item.event_type);
          return { user_id: userId, account_id: accountId, category_id: expense ? expenseCategoryId : incomeCategoryId, type: expense ? 'expense' : 'income', amount: positiveAmount(item.net, item.amount), currency_code: item.currency, transaction_date: item.transaction_date, merchant: item.payment_method_name || item.event_type, description: `${item.event_type}${item.order_id ? ` · ${item.order_id}` : ''}`, notes: `Imported from ${file.name}`, tags: ['imported', item.event_type], is_recurring: false, import_batch_id: batch.id, external_source_key: `payment:${item.source_key}` };
        });
        for (const part of chunk(transactions)) { const response = await supabase.from('finance_transactions').upsert(part, { onConflict: 'user_id,external_source_key', ignoreDuplicates: true }); if (response.error) throw response.error; }
      }
      await supabase.from('finance_import_batches').update({ imported_count: fresh.length, duplicate_count: parsed.payments.length - fresh.length, status: 'completed' }).eq('id', batch.id).eq('user_id', userId);
      return { batch: { ...batch, imported_count: fresh.length, duplicate_count: parsed.payments.length - fresh.length, status: 'completed' as const }, importedPayments: fresh.length, importedPayouts: 0, duplicateCount: parsed.payments.length - fresh.length };
    }
    const keys = parsed.payouts.map((item) => item.source_key);
    const existing = keys.length ? await supabase.from('finance_payouts').select('source_key').eq('user_id', userId).in('source_key', keys) : { data: [], error: null };
    if (existing.error) throw existing.error;
    const existingKeys = new Set((existing.data ?? []).map((item) => item.source_key));
    const fresh = parsed.payouts.filter((item) => !existingKeys.has(item.source_key));
    for (const part of chunk(fresh)) { const response = await supabase.from('finance_payouts').insert(part.map((item) => ({ ...item, user_id: userId, batch_id: batch.id }))); if (response.error) throw response.error; }
    await supabase.from('finance_import_batches').update({ imported_count: fresh.length, duplicate_count: parsed.payouts.length - fresh.length, status: 'completed' }).eq('id', batch.id).eq('user_id', userId);
    return { batch: { ...batch, imported_count: fresh.length, duplicate_count: parsed.payouts.length - fresh.length, status: 'completed' as const }, importedPayments: 0, importedPayouts: fresh.length, duplicateCount: parsed.payouts.length - fresh.length };
  } catch (error) {
    await supabase.from('finance_import_batches').update({ status: 'failed' }).eq('id', batch.id).eq('user_id', userId);
    throw error;
  }
}
