import { supabase } from './supabase';

export type FinanceAccount = {
  id: string;
  user_id: string;
  name: string;
  account_type: 'bank' | 'cash' | 'wallet' | 'credit_card' | 'savings' | 'investment' | 'other';
  institution: string | null;
  currency_code: string;
  current_balance: number | string;
  credit_limit: number | string | null;
  is_archived: boolean;
};

export type FinanceCategory = { id: string; user_id: string; name: string; kind: string; color: string; icon: string };
export type FinanceTransaction = {
  id: string;
  user_id: string;
  account_id: string | null;
  transfer_account_id: string | null;
  category_id: string | null;
  type: 'income' | 'expense' | 'transfer';
  amount: number | string;
  currency_code: string;
  transaction_date: string;
  merchant: string | null;
  description: string | null;
  notes: string | null;
  tags: string[];
  is_recurring: boolean;
  finance_accounts?: { name: string } | null;
  finance_categories?: { name: string; color: string; icon: string } | null;
};
export type FinanceBudget = { id: string; category_id: string | null; name: string; month_start: string; amount: number | string; currency_code: string };
export type FinanceGoal = { id: string; name: string; target_amount: number | string; current_amount: number | string; target_date: string | null; suggested_monthly_saving: number | string; currency_code: string };
export type RecurringPayment = { id: string; name: string; payment_type: 'bill' | 'subscription' | 'emi' | 'recurring'; amount: number | string; currency_code: string; next_due_date: string; is_paid: boolean; cadence: string };
export type FinanceInvestment = { id: string; name: string; investment_type: string; symbol: string | null; invested_amount: number | string; current_value: number | string; currency_code: string; as_of_date: string };
export type FinanceLoan = { id: string; counterparty_name: string; direction: 'lent' | 'borrowed'; principal: number | string; outstanding: number | string; currency_code: string; due_date: string | null; status: string; notes: string | null };
export type FinanceSplit = { id: string; participant_name: string; amount: number | string; direction: 'owed_to_me' | 'i_owe'; is_settled: boolean; transaction_id: string | null };
export type FinanceNotification = { id: string; kind: 'info' | 'warning' | 'success' | 'reminder'; title: string; body: string; is_read: boolean; created_at: string };

const asNumber = (value: number | string | null | undefined) => Number(value ?? 0);
export const money = (value: number | string | null | undefined, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(asNumber(value));
export const moneyExact = (value: number | string | null | undefined, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(asNumber(value));
export const isoToday = () => new Date().toISOString().slice(0, 10);
export const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;
export const asMoneyString = (value: string) => {
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized || !Number.isFinite(Number(normalized))) return '0.00';
  return Number(normalized).toFixed(2);
};

export async function loadFinanceData(userId: string) {
  if (!supabase) return { accounts: [], categories: [], transactions: [], budgets: [], goals: [], recurring: [], investments: [], loans: [], splits: [], notifications: [] };
  const [accounts, categories, transactions, budgets, goals, recurring, investments, loans, splits, notifications] = await Promise.all([
    supabase.from('finance_accounts').select('*').eq('user_id', userId).eq('is_archived', false).order('created_at'),
    supabase.from('finance_categories').select('*').eq('user_id', userId).order('name'),
    supabase.from('finance_transactions').select('*, finance_accounts(name), finance_categories(name, color, icon)').eq('user_id', userId).order('transaction_date', { ascending: false }).limit(2000),
    supabase.from('finance_budgets').select('*').eq('user_id', userId).eq('month_start', monthStart()).order('name'),
    supabase.from('finance_goals').select('*').eq('user_id', userId).order('target_date'),
    supabase.from('finance_recurring_payments').select('*').eq('user_id', userId).eq('is_active', true).order('next_due_date'),
    supabase.from('finance_investments').select('*').eq('user_id', userId).order('current_value', { ascending: false }),
    supabase.from('finance_loans').select('*').eq('user_id', userId).order('due_date'),
    supabase.from('finance_splits').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.from('finance_notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(12),
  ]);
  const criticalError = [accounts, categories, transactions].find((result) => result.error)?.error;
  if (criticalError) throw criticalError;
  return {
    accounts: (accounts.data ?? []) as FinanceAccount[],
    categories: (categories.data ?? []) as FinanceCategory[],
    transactions: (transactions.data ?? []) as FinanceTransaction[],
    budgets: (budgets.data ?? []) as FinanceBudget[],
    goals: (goals.data ?? []) as FinanceGoal[],
    recurring: (recurring.data ?? []) as RecurringPayment[],
    investments: (investments.data ?? []) as FinanceInvestment[],
    loans: (loans.data ?? []) as FinanceLoan[],
    splits: (splits.data ?? []) as FinanceSplit[],
    notifications: (notifications.data ?? []) as FinanceNotification[],
  };
}

export async function seedFinanceDefaults(userId: string, fullName: string) {
  if (!supabase) return;
  await supabase.from('finance_profiles').upsert({ user_id: userId, full_name: fullName || 'Finance owner', default_currency: 'INR' });
  const { count } = await supabase.from('finance_categories').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (!count) {
    await supabase.from('finance_categories').insert([
      ['Food & dining', 'expense', '#f29b72', '◒'], ['Housing', 'expense', '#9e8be6', '⌂'], ['Transport', 'expense', '#69a9d7', '↗'], ['Shopping', 'expense', '#e5a15a', '◇'], ['Salary', 'income', '#82d84c', '↙'], ['Health', 'expense', '#db7d9b', '✚'],
    ].map(([name, kind, color, icon]) => ({ user_id: userId, name, kind, color, icon })));
  }
}
