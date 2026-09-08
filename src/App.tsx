import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseInitializationError, supabaseProjectRef } from './lib/supabase';
import { connectFinanceRealtime, type FinanceRealtimeStatus } from './lib/realtime';
import {
  asMoneyString,
  DEFAULT_CURRENCY,
  isoToday,
  loadFinanceData,
  money,
  moneyExact,
  monthStart,
  seedFinanceDefaults,
  type FinanceAccount,
  type FinanceBudget,
  type FinanceCategory,
  type FinanceGoal,
  type FinanceInvestment,
  type FinanceLoan,
  type FinanceNotification,
  type FinanceSplit,
  type FinanceTransaction,
  type RecurringPayment,
} from './lib/finance';
import {
  analyzeImportData,
  deleteImportedBatch,
  emptyImportData,
  loadImportData,
  parseImportFile,
  persistParsedImport,
  SHOPIFY_EXPORT_REQUIREMENTS,
  type FinanceImportBatch,
  type ImportAnalysis,
  type ImportData,
  type ImportSourceKind,
} from './lib/imports';

type View = 'overview' | 'transactions' | 'accounts' | 'budgets' | 'goals' | 'bills' | 'investments' | 'analytics' | 'lending' | 'reports' | 'calendar' | 'imports';
type AuthMode = 'login' | 'signup' | 'reset';
type Modal = 'transaction' | 'account' | 'budget' | 'goal' | 'bill' | 'investment' | 'loan' | 'split' | null;
type TransactionSourceFilter = 'all' | 'manual' | 'imported';

type FinanceData = {
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  transactions: FinanceTransaction[];
  budgets: FinanceBudget[];
  goals: FinanceGoal[];
  recurring: RecurringPayment[];
  investments: FinanceInvestment[];
  loans: FinanceLoan[];
  splits: FinanceSplit[];
  notifications: FinanceNotification[];
};

type TransactionForm = { type: 'expense' | 'income' | 'transfer'; amount: string; accountId: string; transferAccountId: string; categoryId: string; merchant: string; description: string; transactionDate: string; tags: string };
type ShopifyImportPeriod = 'last_month' | 'last_3_months' | 'last_6_months' | 'last_1_year' | 'lifetime';
type ShopifySyncResponse = { error?: string; code?: string; authorizationUrl?: string; range?: { label?: string | null }; files?: { name: string; content: string; source: string; rows: number }[]; warnings?: string[] };

const views: { id: View; label: string; icon: string; group: string }[] = [
  { id: 'overview', label: 'Overview', icon: '◈', group: 'Workspace' },
  { id: 'transactions', label: 'Transactions', icon: '↕', group: 'Workspace' },
  { id: 'accounts', label: 'Accounts', icon: '▤', group: 'Workspace' },
  { id: 'budgets', label: 'Budgets', icon: '◒', group: 'Plan' },
  { id: 'goals', label: 'Savings goals', icon: '◎', group: 'Plan' },
  { id: 'bills', label: 'Bills & subscriptions', icon: '◷', group: 'Plan' },
  { id: 'investments', label: 'Investments', icon: '↗', group: 'Grow' },
  { id: 'lending', label: 'Lending & splits', icon: '⇄', group: 'Grow' },
  { id: 'analytics', label: 'Analytics', icon: '▥', group: 'Understand' },
  { id: 'reports', label: 'Reports', icon: '▦', group: 'Understand' },
  { id: 'calendar', label: 'Financial calendar', icon: '□', group: 'Understand' },
  { id: 'imports', label: 'Shopify import center', icon: '⇵', group: 'Understand' },
];

const emptyData: FinanceData = { accounts: [], categories: [], transactions: [], budgets: [], goals: [], recurring: [], investments: [], loans: [], splits: [], notifications: [] };
const today = new Date();
const MAX_IMPORT_FILE_SIZE = 25 * 1024 * 1024;
const localDatePart = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const dateOffset = (days: number) => { const d = new Date(today); d.setDate(d.getDate() + days); return localDatePart(d); };
const importFileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
const sourceKindLabels: Record<ImportSourceKind, string> = {
  payment_transactions: 'Payment transactions',
  shopify_payment_transactions: 'Payments transactions',
  shopify_orders: 'Shopify orders',
  shopify_products: 'Shopify products + costs',
  operating_expenses: 'Operating expenses',
  payouts: 'Payout activity',
};
const sourceKindLabel = (kind: ImportSourceKind) => sourceKindLabels[kind] || 'Shopify export';
const SHOPIFY_IMPORT_PERIODS: { value: ShopifyImportPeriod; label: string; description: string }[] = [
  { value: 'last_month', label: 'Last month', description: 'Previous complete calendar month' },
  { value: 'last_3_months', label: 'Last 3 months', description: 'Previous 3 complete calendar months' },
  { value: 'last_6_months', label: 'Last 6 months', description: 'Previous 6 complete calendar months' },
  { value: 'last_1_year', label: 'Last 1 year', description: 'Previous 12 complete calendar months' },
  { value: 'lifetime', label: 'Lifetime', description: 'Everything available in Shopify' },
];
const realtimeStatusLabels: Record<FinanceRealtimeStatus, string> = {
  connecting: 'Connecting live data',
  connected: 'Live updates on',
  reconnecting: 'Reconnecting live data',
  error: 'Live updates unavailable',
  offline: 'Live updates offline',
};
const downloadOperatingExpenseTemplate = () => {
  const csv = ['Date,Category,Description,Amount,Currency', '2026-09-01,Shopify apps,Example subscription,49.00,USD', '2026-09-02,Advertising,Example campaign,125.00,USD'].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `shopify-operating-expenses-template-${isoToday()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
};

const demoCategories: FinanceCategory[] = [
  { id: 'cat-food', user_id: 'demo', name: 'Food & dining', kind: 'expense', color: '#f29b72', icon: '◒' },
  { id: 'cat-house', user_id: 'demo', name: 'Housing', kind: 'expense', color: '#9e8be6', icon: '⌂' },
  { id: 'cat-transport', user_id: 'demo', name: 'Transport', kind: 'expense', color: '#69a9d7', icon: '↗' },
  { id: 'cat-salary', user_id: 'demo', name: 'Salary', kind: 'income', color: '#82d84c', icon: '↙' },
  { id: 'cat-shopping', user_id: 'demo', name: 'Shopping', kind: 'expense', color: '#e5a15a', icon: '◇' },
];
const demoAccounts: FinanceAccount[] = [
  { id: 'acc-hdfc', user_id: 'demo', name: 'HDFC Salary Account', account_type: 'bank', institution: 'HDFC Bank', currency_code: DEFAULT_CURRENCY, current_balance: 148620, credit_limit: null, is_archived: false },
  { id: 'acc-cash', user_id: 'demo', name: 'Cash wallet', account_type: 'cash', institution: null, currency_code: DEFAULT_CURRENCY, current_balance: 8200, credit_limit: null, is_archived: false },
  { id: 'acc-amazon', user_id: 'demo', name: 'Amazon Pay', account_type: 'wallet', institution: 'Amazon', currency_code: DEFAULT_CURRENCY, current_balance: 1650, credit_limit: null, is_archived: false },
  { id: 'acc-credit', user_id: 'demo', name: 'ICICI Credit Card', account_type: 'credit_card', institution: 'ICICI Bank', currency_code: DEFAULT_CURRENCY, current_balance: -18740, credit_limit: 150000, is_archived: false },
];
const demoTransactions: FinanceTransaction[] = [
  { id: 'txn-1', user_id: 'demo', account_id: 'acc-hdfc', transfer_account_id: null, category_id: 'cat-salary', type: 'income', amount: 125000, currency_code: DEFAULT_CURRENCY, transaction_date: dateOffset(-1), merchant: 'GCSRV LLC', description: 'Monthly salary', notes: null, tags: ['salary'], is_recurring: true, finance_accounts: { name: 'HDFC Salary Account' }, finance_categories: { name: 'Salary', color: '#82d84c', icon: '↙' } },
  { id: 'txn-2', user_id: 'demo', account_id: 'acc-hdfc', transfer_account_id: null, category_id: 'cat-house', type: 'expense', amount: 28500, currency_code: DEFAULT_CURRENCY, transaction_date: dateOffset(-3), merchant: 'Noida Heights', description: 'Rent payment', notes: null, tags: ['home'], is_recurring: true, finance_accounts: { name: 'HDFC Salary Account' }, finance_categories: { name: 'Housing', color: '#9e8be6', icon: '⌂' } },
  { id: 'txn-3', user_id: 'demo', account_id: 'acc-credit', transfer_account_id: null, category_id: 'cat-food', type: 'expense', amount: 1840, currency_code: DEFAULT_CURRENCY, transaction_date: dateOffset(-4), merchant: 'Swiggy', description: 'Dinner with team', notes: null, tags: ['team'], is_recurring: false, finance_accounts: { name: 'ICICI Credit Card' }, finance_categories: { name: 'Food & dining', color: '#f29b72', icon: '◒' } },
  { id: 'txn-4', user_id: 'demo', account_id: 'acc-hdfc', transfer_account_id: null, category_id: 'cat-transport', type: 'expense', amount: 960, currency_code: DEFAULT_CURRENCY, transaction_date: dateOffset(-6), merchant: 'Uber', description: 'Client meeting', notes: null, tags: ['work'], is_recurring: false, finance_accounts: { name: 'HDFC Salary Account' }, finance_categories: { name: 'Transport', color: '#69a9d7', icon: '↗' } },
  { id: 'txn-5', user_id: 'demo', account_id: 'acc-credit', transfer_account_id: null, category_id: 'cat-shopping', type: 'expense', amount: 3299, currency_code: DEFAULT_CURRENCY, transaction_date: dateOffset(-8), merchant: 'Myntra', description: 'Workwear', notes: null, tags: ['personal'], is_recurring: false, finance_accounts: { name: 'ICICI Credit Card' }, finance_categories: { name: 'Shopping', color: '#e5a15a', icon: '◇' } },
  { id: 'txn-6', user_id: 'demo', account_id: 'acc-hdfc', transfer_account_id: null, category_id: 'cat-food', type: 'expense', amount: 650, currency_code: DEFAULT_CURRENCY, transaction_date: dateOffset(-10), merchant: 'Blue Tokai', description: 'Coffee', notes: null, tags: [], is_recurring: false, finance_accounts: { name: 'HDFC Salary Account' }, finance_categories: { name: 'Food & dining', color: '#f29b72', icon: '◒' } },
];
const demoData: FinanceData = {
  accounts: demoAccounts,
  categories: demoCategories,
  transactions: demoTransactions,
  budgets: [{ id: 'budget-food', category_id: 'cat-food', name: 'Food & dining', month_start: monthStart(), amount: 10000, currency_code: DEFAULT_CURRENCY }, { id: 'budget-house', category_id: 'cat-house', name: 'Housing', month_start: monthStart(), amount: 30000, currency_code: DEFAULT_CURRENCY }, { id: 'budget-shop', category_id: 'cat-shopping', name: 'Shopping', month_start: monthStart(), amount: 8000, currency_code: DEFAULT_CURRENCY }],
  goals: [{ id: 'goal-emergency', name: 'Emergency fund', target_amount: 300000, current_amount: 172500, target_date: dateOffset(180), suggested_monthly_saving: 21250, currency_code: DEFAULT_CURRENCY }, { id: 'goal-trip', name: 'Japan trip', target_amount: 180000, current_amount: 73500, target_date: dateOffset(270), suggested_monthly_saving: 11800, currency_code: DEFAULT_CURRENCY }],
  recurring: [{ id: 'bill-rent', name: 'Noida Heights rent', payment_type: 'bill', amount: 28500, currency_code: DEFAULT_CURRENCY, next_due_date: dateOffset(4), is_paid: false, cadence: 'monthly' }, { id: 'bill-notion', name: 'Notion Plus', payment_type: 'subscription', amount: 800, currency_code: DEFAULT_CURRENCY, next_due_date: dateOffset(7), is_paid: false, cadence: 'monthly' }, { id: 'bill-sip', name: 'Index fund SIP', payment_type: 'emi', amount: 15000, currency_code: DEFAULT_CURRENCY, next_due_date: dateOffset(11), is_paid: false, cadence: 'monthly' }],
  investments: [{ id: 'inv-nifty', name: 'Nifty 50 Index Fund', investment_type: 'mutual_fund', symbol: 'NIFTY50', invested_amount: 82000, current_value: 94650, currency_code: DEFAULT_CURRENCY, as_of_date: isoToday() }, { id: 'inv-gold', name: 'Digital gold', investment_type: 'gold', symbol: null, invested_amount: 32500, current_value: 35800, currency_code: DEFAULT_CURRENCY, as_of_date: isoToday() }],
  loans: [{ id: 'loan-1', counterparty_name: 'Aarav', direction: 'lent', principal: 12000, outstanding: 6500, currency_code: DEFAULT_CURRENCY, due_date: dateOffset(22), status: 'open', notes: 'Laptop repair' }],
  splits: [{ id: 'split-1', participant_name: 'Mira', amount: 1450, direction: 'owed_to_me', is_settled: false, transaction_id: 'txn-3' }],
  notifications: [{ id: 'note-1', kind: 'warning', title: 'Food budget is 68% used', body: 'You have $3,200 left for the rest of the month.', is_read: false, created_at: new Date().toISOString() }, { id: 'note-2', kind: 'reminder', title: '3 payments due this month', body: 'Rent, Notion, and your SIP are coming up.', is_read: false, created_at: new Date().toISOString() }],
};

const newTransaction = (): TransactionForm => ({ type: 'expense', amount: '', accountId: '', transferAccountId: '', categoryId: '', merchant: '', description: '', transactionDate: isoToday(), tags: '' });
const categoriesForTransaction = (categories: FinanceCategory[], type: TransactionForm['type']) => type === 'income' ? categories.filter((category) => category.kind === 'income') : categories.filter((category) => category.kind !== 'income');
const number = (value: number | string | null | undefined) => Number(value ?? 0);
const dateLabel = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`)) : '—';
const longDateLabel = (value: Date) => new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(value);
const monthLabel = (value: Date) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(value);
const readStoredBoolean = (key: string, fallback: boolean) => {
  try { return window.localStorage.getItem(key) === 'true'; } catch { return fallback; }
};
const readStoredView = (): View => {
  try {
    const stored = window.localStorage.getItem('gcs-books-view');
    return views.some((item) => item.id === stored) ? stored as View : 'overview';
  } catch { return 'overview'; }
};
const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, timeoutMessage = 'The Supabase connection timed out.') => new Promise<T>((resolve, reject) => {
  const timer = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  promise.then((value) => { window.clearTimeout(timer); resolve(value); }, (error) => { window.clearTimeout(timer); reject(error); });
});
const AUTH_EMAIL_COOLDOWN_KEY = 'gcs-books-auth-email-cooldown-until';
const AUTH_EMAIL_RETRY_COOLDOWN_MS = 60 * 1000;
const AUTH_EMAIL_RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000;
const AUTH_EMAIL_RATE_LIMIT_MESSAGE = 'Supabase email sending is temporarily limited. Please wait for the quota to reset before requesting another email. For production, configure a custom SMTP provider in Supabase.';
const isEmailRateLimitError = (message: string) => /email.*rate.?limit|rate.?limit.*email|too many.*email|email.*too many/i.test(message.toLowerCase());
const readAuthEmailCooldown = () => {
  try {
    const stored = Number(window.localStorage.getItem(AUTH_EMAIL_COOLDOWN_KEY) || 0);
    return stored > Date.now() ? stored : 0;
  } catch {
    return 0;
  }
};
const formatCooldown = (seconds: number) => seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
const describeError = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null) {
    const details = ['message', 'details', 'hint', 'code']
      .map((key) => key in error && typeof error[key as keyof typeof error] === 'string' ? error[key as keyof typeof error] as string : '')
      .filter(Boolean);
    if (details.length) return details.join(' · ');
  }
  return fallback;
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [canResendConfirmation, setCanResendConfirmation] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [emailCooldownUntil, setEmailCooldownUntil] = useState(readAuthEmailCooldown);
  const [emailCooldownSeconds, setEmailCooldownSeconds] = useState(0);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [view, setView] = useState<View>(readStoredView);
  const [data, setData] = useState<FinanceData>(emptyData);
  const [localData, setLocalData] = useState<FinanceData>(demoData);
  const [importedData, setImportedData] = useState<ImportData>(emptyImportData);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [shopifySyncLoading, setShopifySyncLoading] = useState(false);
  const [shopifySyncError, setShopifySyncError] = useState('');
  const [shopifySyncMessage, setShopifySyncMessage] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState<FinanceRealtimeStatus>('offline');
  const [realtimeMessage, setRealtimeMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [darkMode, setDarkMode] = useState(() => readStoredBoolean('gcs-books-dark-mode', false));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantQuestion, setAssistantQuestion] = useState('');
  const [assistantAnswer, setAssistantAnswer] = useState('Ask me anything about your money.');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [transactionForm, setTransactionForm] = useState<TransactionForm>(newTransaction());
  const [search, setSearch] = useState('');
  const [transactionFilter, setTransactionFilter] = useState<'all' | 'income' | 'expense' | 'transfer'>('all');
  const [transactionSourceFilter, setTransactionSourceFilter] = useState<TransactionSourceFilter>('all');
  const [toast, setToast] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmImportDelete, setConfirmImportDelete] = useState<FinanceImportBatch | null>(null);
  const [importDeleteLoading, setImportDeleteLoading] = useState(false);

  const activeData = demoMode ? localData : data;
  const userName = demoMode ? 'Shadma' : String(session?.user.user_metadata?.full_name || session?.user.email?.split('@')[0] || 'there');
  const currentUserId = session?.user.id;
  const globalSearchRef = useRef<HTMLInputElement>(null);
  const shopifyImportHandlerRef = useRef<((period: ShopifyImportPeriod, storeDomain?: string) => Promise<boolean>) | null>(null);
  const shopifyOAuthResumeRef = useRef<string | null>(null);

  const refreshData = useCallback(async (userId: string, options: { background?: boolean } = {}) => {
    const background = options.background === true;
    if (!background) setLoading(true);
    setDataError('');
    try {
      let result = await withTimeout(loadFinanceData(userId), 12000);
      if (!result.categories.length) {
        await withTimeout(seedFinanceDefaults(userId, session?.user.user_metadata?.full_name || authName || 'Finance owner'), 12000);
        result = await withTimeout(loadFinanceData(userId), 12000);
      }
      setData(result);
      try {
        setImportedData(await withTimeout(loadImportData(userId), 12000));
      } catch (error) {
        setImportedData(emptyImportData);
        setDataError(`Finance data loaded, but imported records are temporarily unavailable: ${describeError(error, 'Please retry shortly.')}`);
      }
    } catch (error) {
      setDataError(describeError(error, 'We could not load your finance data.'));
    } finally {
      if (!background) setLoading(false);
    }
  }, [authName, session?.user.user_metadata]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      if (supabaseInitializationError) setAuthError(`Supabase setup needs attention: ${supabaseInitializationError}`);
      return;
    }
    const client = supabase;
    let mounted = true;
    const bootstrapSession = async () => {
      try {
        const { data: { session: currentSession }, error } = await withTimeout(client.auth.getSession(), 7000);
        if (!mounted) return;
        if (error) throw error;
        setSession(currentSession);
      } catch (error) {
        if (mounted) setAuthError(`We couldn't reach Supabase. You can still preview the demo workspace. ${describeError(error, 'Please check your connection and try again.')}`);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void bootstrapSession();
    const { data: { subscription } } = client.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
        setAuthMode('reset');
        setAuthPassword('');
        setAuthMessage('Choose a new password for your workspace.');
      }
    });
    return () => { mounted = false; void subscription.unsubscribe(); };
  }, []);

  useEffect(() => { if (session?.user.id && !demoMode) void refreshData(session.user.id); }, [demoMode, refreshData, session?.user.id]);

  useEffect(() => {
    if (!supabase || !session?.user.id || demoMode) {
      setRealtimeStatus('offline');
      setRealtimeMessage(demoMode ? 'Demo data is local to this browser.' : 'Sign in to enable live updates.');
      return;
    }

    const userId = session.user.id;
    let disposed = false;
    let refreshTimer: number | undefined;
    setRealtimeStatus('connecting');
    setRealtimeMessage('');

    const scheduleRefresh = () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        if (!disposed) void refreshData(userId, { background: true });
      }, 350);
    };

    const disconnect = connectFinanceRealtime(
      supabase,
      userId,
      ({ status, message }) => {
        if (disposed) return;
        setRealtimeStatus(status);
        setRealtimeMessage(message || '');
      },
      scheduleRefresh,
    );

    return () => {
      disposed = true;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      disconnect();
    };
  }, [demoMode, refreshData, session?.user.id]);

  useEffect(() => {
    try { window.localStorage.setItem('gcs-books-view', view); } catch { /* storage can be disabled */ }
  }, [view]);

  useEffect(() => {
    try { window.localStorage.setItem('gcs-books-dark-mode', String(darkMode)); } catch { /* storage can be disabled */ }
  }, [darkMode]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        globalSearchRef.current?.focus();
      }
      if (event.key === 'Escape') {
        setNotificationsOpen(false);
        setAssistantOpen(false);
        if (modal) setModal(null);
        if (confirmDelete) setConfirmDelete(null);
        if (confirmImportDelete && !importDeleteLoading) setConfirmImportDelete(null);
      }
    };
    document.addEventListener('keydown', handleShortcut);
    document.body.style.overflow = modal || assistantOpen ? 'hidden' : '';
    return () => { document.removeEventListener('keydown', handleShortcut); document.body.style.overflow = ''; };
  }, [assistantOpen, confirmDelete, confirmImportDelete, importDeleteLoading, modal]);

  useEffect(() => {
    const updateCooldown = () => {
      const seconds = Math.max(0, Math.ceil((emailCooldownUntil - Date.now()) / 1000));
      setEmailCooldownSeconds(seconds);
      if (!seconds && emailCooldownUntil) {
        setEmailCooldownUntil(0);
        try { window.localStorage.removeItem(AUTH_EMAIL_COOLDOWN_KEY); } catch { /* localStorage may be unavailable */ }
      }
    };
    updateCooldown();
    if (!emailCooldownUntil) return;
    const timer = window.setInterval(updateCooldown, 1000);
    return () => window.clearInterval(timer);
  }, [emailCooldownUntil]);

  const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3200); };

  function activateEmailCooldown(durationMs: number) {
    const until = Date.now() + durationMs;
    setEmailCooldownUntil(until);
    setEmailCooldownSeconds(Math.ceil(durationMs / 1000));
    try { window.localStorage.setItem(AUTH_EMAIL_COOLDOWN_KEY, String(until)); } catch { /* localStorage may be unavailable */ }
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAuthError(''); setAuthMessage(''); setCanResendConfirmation(false);
    const normalizedEmail = authEmail.trim().toLowerCase();
    const requestAuth = async <T,>(request: Promise<T>) => {
      setAuthLoading(true);
      try {
        return await withTimeout(request, 10000);
      } catch (error) {
        setAuthError(`We couldn't reach Supabase. ${describeError(error, 'Please check your connection and try again.')}`);
        return null;
      } finally {
        setAuthLoading(false);
      }
    };
    if (authMode === 'reset') {
      if (passwordRecovery) {
        if (authPassword.length < 8) { setAuthError('Use at least 8 characters for your new password.'); return; }
        if (!supabase) { setAuthError('Password updates require a connected Supabase project.'); return; }
        const response = await requestAuth(supabase.auth.updateUser({ password: authPassword }));
        if (!response) return;
        const { error } = response;
        if (error) setAuthError(error.message); else { setPasswordRecovery(false); setAuthMessage('Password updated. Your workspace is ready.'); }
        return;
      }
      if (!normalizedEmail) { setAuthError('Enter your email first.'); return; }
      if (!supabase) { setAuthMessage('Demo mode does not send emails. Use the demo workspace instead.'); return; }
      const response = await requestAuth(supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo: window.location.origin }));
      if (!response) return;
      const { error } = response;
      if (error) {
        if (isEmailRateLimitError(error.message)) activateEmailCooldown(AUTH_EMAIL_RATE_LIMIT_COOLDOWN_MS);
        setAuthError(isEmailRateLimitError(error.message) ? AUTH_EMAIL_RATE_LIMIT_MESSAGE : error.message);
      } else { activateEmailCooldown(AUTH_EMAIL_RETRY_COOLDOWN_MS); setAuthMessage('Reset instructions are on the way. Check your inbox.'); }
      return;
    }
    if (!authEmail.trim() || !authPassword.trim() || (authMode === 'signup' && !authName.trim())) { setAuthError(authMode === 'signup' ? 'Add your name, email, and password.' : 'Enter your email and password to continue.'); return; }
    if (!supabase) {
      setAuthError('Supabase is not available in this build. Use the demo workspace, or add the VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY variables.');
      return;
    }
    const response = authMode === 'signup'
      ? await requestAuth(supabase.auth.signUp({ email: normalizedEmail, password: authPassword, options: { data: { full_name: authName }, emailRedirectTo: window.location.origin } }))
      : await requestAuth(supabase.auth.signInWithPassword({ email: normalizedEmail, password: authPassword }));
    if (!response) return;
    if (response.error) {
      const emailNotConfirmed = response.error.message.toLowerCase().includes('email not confirmed');
      const emailRateLimited = isEmailRateLimitError(response.error.message);
      if (emailRateLimited) activateEmailCooldown(AUTH_EMAIL_RATE_LIMIT_COOLDOWN_MS);
      setCanResendConfirmation(emailNotConfirmed);
      setAuthError(emailRateLimited ? AUTH_EMAIL_RATE_LIMIT_MESSAGE : emailNotConfirmed ? 'Your email is not confirmed yet. Check your inbox or resend the confirmation email below.' : response.error.message);
      return;
    }
    if (authMode === 'signup' && !response.data.session) setAuthMessage('Check your email to confirm your account, then sign in.');
    setSession(response.data.session);
  }

  async function resendConfirmation() {
    const normalizedEmail = authEmail.trim().toLowerCase();
    if (!normalizedEmail) { setAuthError('Enter your email first.'); return; }
    if (!supabase) { setAuthError('Confirmation emails require a connected Supabase project.'); return; }
    if (emailCooldownSeconds > 0) { setAuthError(`Please wait ${formatCooldown(emailCooldownSeconds)} before requesting another email.`); return; }
    setResendLoading(true); setAuthError(''); setAuthMessage('');
    let response: Awaited<ReturnType<typeof supabase.auth.resend>>;
    try {
      response = await withTimeout(supabase.auth.resend({ type: 'signup', email: normalizedEmail, options: { emailRedirectTo: window.location.origin } }), 10000);
    } catch (error) {
      setAuthError(`We couldn't reach Supabase. ${describeError(error, 'Please check your connection and try again.')}`);
      setResendLoading(false);
      return;
    }
    setResendLoading(false);
    const { error } = response;
    if (error) {
      if (isEmailRateLimitError(error.message)) activateEmailCooldown(AUTH_EMAIL_RATE_LIMIT_COOLDOWN_MS);
      setAuthError(isEmailRateLimitError(error.message) ? AUTH_EMAIL_RATE_LIMIT_MESSAGE : error.message);
    } else { activateEmailCooldown(AUTH_EMAIL_RETRY_COOLDOWN_MS); setCanResendConfirmation(false); setAuthMessage('A fresh confirmation email is on the way. Check spam or promotions too.'); }
  }

  async function logout() {
    if (supabase && session) {
      try { await withTimeout(supabase.auth.signOut(), 7000); } catch { /* clear local state even if the network is unavailable */ }
    }
    setSession(null); setDemoMode(false); setView('overview'); setData(emptyData); setImportedData(emptyImportData); setImportError(''); setImportMessage(''); setShopifySyncError(''); setShopifySyncMessage(''); showToast('You have been signed out.');
  }

  function startDemo() { setDemoMode(true); setImportedData(emptyImportData); setImportError(''); setImportMessage(''); setShopifySyncError(''); setShopifySyncMessage(''); setAuthMessage(''); setAuthError(''); setDataError(''); setView('overview'); }

  async function handleImportFiles(files: File[]): Promise<boolean> {
    if (!files.length) return false;
    setImportLoading(true); setImportError(''); setImportMessage('');
    try {
      const oversized = files.find((file) => file.size > MAX_IMPORT_FILE_SIZE);
      if (oversized) throw new Error(`${oversized.name} is larger than 25 MB. Split the export into smaller files and try again.`);
      const parsedFiles = await Promise.all(files.map((file) => parseImportFile(file)));
      if (demoMode) {
        const seenKeys = new Set([
          ...importedData.payments.map((item) => item.source_key),
          ...importedData.payouts.map((item) => item.source_key),
          ...importedData.orders.map((item) => item.source_key),
          ...importedData.products.map((item) => item.source_key),
          ...importedData.expenses.map((item) => item.source_key),
        ]);
        const freshRows = <T extends { source_key: string },>(rows: T[]) => rows.filter((item) => {
          if (seenKeys.has(item.source_key)) return false;
          seenKeys.add(item.source_key);
          return true;
        });
        const freshParsedFiles = parsedFiles.map((parsed) => ({
          ...parsed,
          payments: freshRows(parsed.payments),
          payouts: freshRows(parsed.payouts),
          orders: freshRows(parsed.orders),
          products: freshRows(parsed.products),
          expenses: freshRows(parsed.expenses),
        }));
        const nextBatches: FinanceImportBatch[] = freshParsedFiles.map((parsed, index) => {
          const analysis = analyzeImportData(parsed);
          const originalValidCount = parsedFiles[index].payments.length + parsedFiles[index].payouts.length + parsedFiles[index].orders.length + parsedFiles[index].products.length + parsedFiles[index].expenses.length;
          const originalCount = originalValidCount + parsed.reviewRows.length;
          const totals = parsed.source_kind === 'shopify_orders'
            ? { total_amount: analysis.grossSales, total_fee: 0, total_net: analysis.netSales }
            : parsed.source_kind === 'shopify_products'
              ? { total_amount: 0, total_fee: 0, total_net: 0 }
              : parsed.source_kind === 'operating_expenses'
                ? { total_amount: analysis.operatingExpenses, total_fee: 0, total_net: -analysis.operatingExpenses }
                : parsed.source_kind === 'payouts'
                  ? { total_amount: analysis.payoutTotal, total_fee: analysis.payoutFees, total_net: analysis.payoutTotal }
                  : { total_amount: analysis.grossVolume, total_fee: analysis.paymentFees, total_net: analysis.paymentNet };
          return { id: `demo-import-${Date.now()}-${index}`, user_id: 'demo', file_name: files[index].name, file_type: parsed.file_type, source_kind: parsed.source_kind, file_size: files[index].size, row_count: originalCount, imported_count: analysis.totalRows, duplicate_count: originalValidCount - analysis.totalRows, review_count: parsed.reviewRows.length, ...totals, currency_code: analysis.currency, status: 'completed', imported_at: new Date().toISOString(), metadata: { review_rows: parsed.reviewRows } };
        });
        const importedPaymentRows = freshParsedFiles.flatMap((parsed, fileIndex) => parsed.payments.map((item) => ({ ...item, batch_id: nextBatches[fileIndex].id })));
        const importedPayoutRows = freshParsedFiles.flatMap((parsed, fileIndex) => parsed.payouts.map((item) => ({ ...item, batch_id: nextBatches[fileIndex].id })));
        const importedOrderRows = freshParsedFiles.flatMap((parsed, fileIndex) => parsed.orders.map((item) => ({ ...item, batch_id: nextBatches[fileIndex].id })));
        const importedProductRows = freshParsedFiles.flatMap((parsed, fileIndex) => parsed.products.map((item) => ({ ...item, batch_id: nextBatches[fileIndex].id })));
        const importedExpenseRows = freshParsedFiles.flatMap((parsed, fileIndex) => parsed.expenses.map((item) => ({ ...item, batch_id: nextBatches[fileIndex].id })));
        const importedTransactions: FinanceTransaction[] = freshParsedFiles.flatMap((parsed, fileIndex) => parsed.payments.filter((item) => number(item.net || item.amount) !== 0).map((item, rowIndex) => {
          const expense = item.net.startsWith('-') || item.amount.startsWith('-') || /refund|chargeback|tax|adjustment/.test(item.event_type);
          return { id: `demo-import-transaction-${Date.now()}-${fileIndex}-${rowIndex}`, user_id: 'demo', account_id: 'demo-imported-account', transfer_account_id: null, category_id: expense ? 'demo-import-expense' : 'demo-import-income', type: expense ? 'expense' : 'income', amount: Math.abs(number(item.net || item.amount)), currency_code: item.currency, transaction_date: item.transaction_date, merchant: item.payment_method_name || item.event_type, description: `${item.event_type}${item.order_id ? ` · ${item.order_id}` : ''}`, notes: `Imported from ${files[fileIndex].name}`, tags: ['imported', item.event_type], is_recurring: false, import_batch_id: nextBatches[fileIndex].id, finance_accounts: { name: 'Imported payment activity' }, finance_categories: { name: expense ? 'Refunds & adjustments' : 'Payment revenue', color: expense ? '#e5a15a' : '#82d84c', icon: expense ? '↗' : '↙' } };
        }));
        const importedNet = freshParsedFiles.flatMap((item) => item.payments).reduce((sum, item) => sum + number(item.net), 0);
        setImportedData((current) => ({ batches: [...nextBatches, ...current.batches], payments: [...importedPaymentRows, ...current.payments], payouts: [...importedPayoutRows, ...current.payouts], orders: [...importedOrderRows, ...current.orders], products: [...importedProductRows, ...current.products], expenses: [...importedExpenseRows, ...current.expenses] }));
        if (freshParsedFiles.some((item) => item.payments.length)) {
          setLocalData((current) => ({ ...current, accounts: current.accounts.some((item) => item.id === 'demo-imported-account') ? current.accounts.map((item) => item.id === 'demo-imported-account' ? { ...item, current_balance: number(item.current_balance) + importedNet } : item) : [...current.accounts, { id: 'demo-imported-account', user_id: 'demo', name: 'Imported payment activity', account_type: 'bank', institution: 'Payment processor exports', currency_code: freshParsedFiles.flatMap((item) => item.payments)[0]?.currency || 'USD', current_balance: importedNet, credit_limit: null, is_archived: false }], categories: [...current.categories.filter((item) => !['demo-import-income', 'demo-import-expense'].includes(item.id)), { id: 'demo-import-income', user_id: 'demo', name: 'Payment revenue', kind: 'income', color: '#82d84c', icon: '↙' }, { id: 'demo-import-expense', user_id: 'demo', name: 'Refunds & adjustments', kind: 'expense', color: '#e5a15a', icon: '↗' }], transactions: [...importedTransactions, ...current.transactions] }));
        }
        const totalImported = freshParsedFiles.reduce((sum, item) => sum + item.payments.length + item.payouts.length + item.orders.length + item.products.length + item.expenses.length, 0);
        const originalTotal = parsedFiles.reduce((sum, item) => sum + item.payments.length + item.payouts.length + item.orders.length + item.products.length + item.expenses.length, 0);
        const duplicateCount = originalTotal - totalImported;
        const reviewCount = parsedFiles.reduce((sum, item) => sum + item.reviewRows.length, 0);
        const sourceSummary = [
          importedOrderRows.length ? `${importedOrderRows.length} orders` : '',
          importedProductRows.length ? `${importedProductRows.length} products` : '',
          importedPaymentRows.length ? `${importedPaymentRows.length} payment rows` : '',
          importedPayoutRows.length ? `${importedPayoutRows.length} payouts` : '',
          importedExpenseRows.length ? `${importedExpenseRows.length} expenses` : '',
        ].filter(Boolean).join(' · ');
        setImportMessage(`${totalImported} imported in demo mode${sourceSummary ? ` · ${sourceSummary}` : ''}${duplicateCount ? ` · ${duplicateCount} duplicates skipped` : ''}${reviewCount ? ` · ${reviewCount} need review` : ''}. Sign in to persist them to your workspace.`);
      } else if (supabase && currentUserId) {
        let importedPayments = 0; let importedPayouts = 0; let importedOrders = 0; let importedProducts = 0; let importedExpenses = 0; let duplicates = 0; let reviewCount = 0;
        for (let index = 0; index < parsedFiles.length; index += 1) {
          const result = await withTimeout(persistParsedImport(currentUserId, files[index], parsedFiles[index]), 30000);
          importedPayments += result.importedPayments; importedPayouts += result.importedPayouts; importedOrders += result.importedOrders; importedProducts += result.importedProducts; importedExpenses += result.importedExpenses; duplicates += result.duplicateCount; reviewCount += result.reviewCount;
        }
        setImportedData(await withTimeout(loadImportData(currentUserId), 12000));
        await refreshData(currentUserId);
        const sourceSummary = [
          importedOrders ? `${importedOrders} orders` : '',
          importedProducts ? `${importedProducts} products` : '',
          importedPayments ? `${importedPayments} payment rows` : '',
          importedPayouts ? `${importedPayouts} payouts` : '',
          importedExpenses ? `${importedExpenses} expenses` : '',
        ].filter(Boolean).join(' · ');
        setImportMessage(`${importedPayments + importedPayouts + importedOrders + importedProducts + importedExpenses} imported${sourceSummary ? ` · ${sourceSummary}` : ''}${duplicates ? ` · ${duplicates} duplicates skipped` : ''}${reviewCount ? ` · ${reviewCount} need review` : ''}.`);
      } else {
        throw new Error('Sign in to import data into your workspace, or use the demo workspace to preview the analysis.');
      }
      return true;
    } catch (error) {
      setImportError(describeError(error, 'We could not read that file.'));
      return false;
    } finally {
      setImportLoading(false);
    }
  }

  async function handleShopifyImport(period: ShopifyImportPeriod, storeDomain?: string): Promise<boolean> {
    setShopifySyncLoading(true);
    setShopifySyncError('');
    setShopifySyncMessage('');
    const authClient = supabase;
    const currentSession = session;
    if (demoMode || !authClient || !currentSession) {
      setShopifySyncError('Sign in to your GCS Books workspace to connect Shopify. Demo imports stay local to this browser.');
      setShopifySyncLoading(false);
      return false;
    }
    try {
      const { data: { session: activeSession }, error: sessionError } = await withTimeout(authClient.auth.getSession(), 7000, 'Supabase session lookup timed out. Sign in again and retry.');
      if (sessionError) throw sessionError;
      if (!activeSession?.access_token) throw new Error('Your Supabase session is no longer valid. Sign in again and retry the Shopify import.');
      const response = await withTimeout(fetch('/api/shopify/import', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeSession.access_token}` },
        body: JSON.stringify({ period, ...(storeDomain ? { storeDomain } : {}) }),
      }), 900_000, 'Shopify authorization/import timed out. Finish the Shopify approval flow or try again.');
      const payload = await response.json().catch(() => ({})) as ShopifySyncResponse;
      if (!response.ok) {
        if (payload.authorizationUrl && (payload.code === 'SHOPIFY_AUTH_REQUIRED' || payload.code === 'SHOPIFY_REAUTH_REQUIRED')) {
          try {
            window.sessionStorage.setItem('gcs-books-shopify-period', period);
            if (storeDomain) window.sessionStorage.setItem('gcs-books-shopify-store-domain', storeDomain);
          } catch { /* session storage may be unavailable */ }
          window.location.assign(payload.authorizationUrl);
          return false;
        }
        throw new Error(payload.error || 'Shopify import failed.');
      }
      const files = (payload.files || []).map((file) => new File([file.content], file.name, { type: 'text/csv' }));
      if (!files.length) throw new Error('Shopify returned no importable files for that period.');
      const imported = await handleImportFiles(files);
      if (!imported) return false;
      const sourceSummary = payload.files?.map((file) => `${file.rows.toLocaleString()} ${file.source.replace('shopify_', '').replace('_', ' ')}`).join(' · ') || 'Shopify records';
      const warningSummary = payload.warnings?.length ? ` ${payload.warnings.join(' ')}` : '';
      setShopifySyncMessage(`Shopify sync complete for ${payload.range?.label || period}: ${sourceSummary}.${warningSummary}`);
      return true;
    } catch (error) {
      setShopifySyncError(describeError(error, 'Shopify import failed. Check the CLI connection and try again.'));
      return false;
    } finally {
      setShopifySyncLoading(false);
    }
  }

  useEffect(() => {
    shopifyImportHandlerRef.current = handleShopifyImport;
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shopifyStatus = params.get('shopify');
    if (shopifyStatus !== 'connected' && shopifyStatus !== 'error') return;
    setView('imports');
    if (shopifyStatus === 'error') {
      setShopifySyncError(params.get('message') || 'Shopify authorization could not be completed. Start the import again.');
      window.history.replaceState({}, '', `${window.location.pathname}?view=imports`);
      return;
    }
    if (!session?.user.id) return;
    const validPeriod = params.get('period');
    const period: ShopifyImportPeriod = validPeriod === 'last_3_months' || validPeriod === 'last_6_months' || validPeriod === 'last_1_year' || validPeriod === 'lifetime' ? validPeriod : 'last_month';
    let storeDomain: string | undefined;
    try { storeDomain = window.sessionStorage.getItem('gcs-books-shopify-store-domain') || undefined; } catch { /* session storage may be unavailable */ }
    const resumeKey = `${session.user.id}:${period}`;
    if (shopifyOAuthResumeRef.current === resumeKey) return;
    shopifyOAuthResumeRef.current = resumeKey;
    window.history.replaceState({}, '', `${window.location.pathname}?view=imports`);
    window.setTimeout(() => { void shopifyImportHandlerRef.current?.(period, storeDomain); }, 0);
  }, [session?.user.id]);

  const stats = useMemo(() => {
    const income = activeData.transactions.filter((t) => t.type === 'income').reduce((sum, t) => sum + number(t.amount), 0);
    const expenses = activeData.transactions.filter((t) => t.type === 'expense').reduce((sum, t) => sum + number(t.amount), 0);
    const balance = activeData.accounts.reduce((sum, account) => sum + number(account.current_balance), 0);
    const investmentValue = activeData.investments.reduce((sum, investment) => sum + number(investment.current_value), 0);
    return { balance, income, expenses, savings: income - expenses, investmentValue, savingsRate: income ? Math.round(((income - expenses) / income) * 100) : 0 };
  }, [activeData]);

  const importedAnalysis = useMemo<ImportAnalysis>(() => analyzeImportData(importedData), [importedData]);

  const categorySpend = useMemo(() => {
    const totals = new Map<string, { name: string; color: string; total: number }>();
    activeData.transactions.filter((transaction) => transaction.type === 'expense').forEach((transaction) => {
      const name = transaction.finance_categories?.name || activeData.categories.find((category) => category.id === transaction.category_id)?.name || 'Uncategorized';
      const color = transaction.finance_categories?.color || activeData.categories.find((category) => category.id === transaction.category_id)?.color || '#92a59a';
      const existing = totals.get(name); totals.set(name, { name, color, total: (existing?.total || 0) + number(transaction.amount) });
    });
    return [...totals.values()].sort((a, b) => b.total - a.total);
  }, [activeData]);

  const filteredTransactions = useMemo(() => activeData.transactions.filter((transaction) => {
    const haystack = `${transaction.merchant || ''} ${transaction.description || ''} ${transaction.notes || ''} ${transaction.finance_categories?.name || ''} ${transaction.tags.join(' ')}`.toLowerCase();
    const sourceMatches = transactionSourceFilter === 'all' || (transactionSourceFilter === 'imported' ? Boolean(transaction.import_batch_id) : !transaction.import_batch_id);
    return (transactionFilter === 'all' || transaction.type === transactionFilter) && sourceMatches && haystack.includes(search.toLowerCase());
  }), [activeData.transactions, search, transactionFilter, transactionSourceFilter]);

  const smartInsights = useMemo(() => {
    const insights: { kind: string; title: string; body: string; icon: string }[] = [];
    if (categorySpend[0]) insights.push({ kind: 'warm', icon: '◒', title: `${categorySpend[0].name} is your top spend`, body: `${money(categorySpend[0].total)} this month — worth a quick review.` });
    const budgetWarning = activeData.budgets.find((budget) => {
      const used = activeData.transactions.filter((t) => t.type === 'expense' && t.category_id === budget.category_id).reduce((sum, t) => sum + number(t.amount), 0); return used / Math.max(number(budget.amount), 1) > .8;
    });
    if (budgetWarning) insights.push({ kind: 'alert', icon: '!', title: `${budgetWarning.name} is nearing its limit`, body: 'You have less than 20% of this budget left.' });
    if (activeData.recurring.length) insights.push({ kind: 'cool', icon: '◷', title: `${activeData.recurring.length} recurring payments ahead`, body: `${money(activeData.recurring.reduce((sum, bill) => sum + number(bill.amount), 0))} expected this cycle.` });
    if (stats.savingsRate > 20) insights.push({ kind: 'green', icon: '↗', title: `Savings rate is ${stats.savingsRate}%`, body: 'You are building a strong buffer this month.' });
    return insights.slice(0, 4);
  }, [activeData, categorySpend, stats.savingsRate]);

  async function addTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(transactionForm.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !transactionForm.accountId) { showToast('Choose an account and enter an amount greater than zero.'); return; }
    if (transactionForm.type === 'transfer' && (!transactionForm.transferAccountId || transactionForm.transferAccountId === transactionForm.accountId)) { showToast('Choose a different destination account for this transfer.'); return; }
    if (transactionForm.type !== 'transfer' && !transactionForm.categoryId) { showToast('Choose a category for this transaction.'); return; }
    const currencyCode = activeData.accounts.find((account) => account.id === transactionForm.accountId)?.currency_code || DEFAULT_CURRENCY;
    const payload = { type: transactionForm.type, amount: asMoneyString(transactionForm.amount), account_id: transactionForm.accountId, transfer_account_id: transactionForm.type === 'transfer' ? transactionForm.transferAccountId : null, category_id: transactionForm.type === 'transfer' ? null : transactionForm.categoryId || null, merchant: transactionForm.merchant.trim() || null, description: transactionForm.description.trim() || null, transaction_date: transactionForm.transactionDate, tags: transactionForm.tags.split(',').map((tag) => tag.trim()).filter(Boolean), currency_code: currencyCode, user_id: currentUserId };
    if (demoMode) {
      const account = activeData.accounts.find((item) => item.id === transactionForm.accountId);
      const category = activeData.categories.find((item) => item.id === transactionForm.categoryId);
      const localTransaction: FinanceTransaction = { ...payload, id: `demo-${Date.now()}`, user_id: 'demo', amount: payload.amount, account_id: payload.account_id, transfer_account_id: payload.transfer_account_id, category_id: payload.category_id, type: payload.type, currency_code: currencyCode, transaction_date: payload.transaction_date, merchant: payload.merchant, description: payload.description, notes: null, tags: payload.tags, is_recurring: false, finance_accounts: account ? { name: account.name } : null, finance_categories: category ? { name: category.name, color: category.color, icon: category.icon } : null };
      setLocalData((current) => ({ ...current, transactions: [localTransaction, ...current.transactions] }));
    } else if (supabase && currentUserId) {
      const { error } = await supabase.from('finance_transactions').insert(payload); if (error) { showToast(error.message); return; } await refreshData(currentUserId);
    } else {
      showToast('Sign in to save transactions, or use the demo workspace.'); return;
    }
    setModal(null); setTransactionForm(newTransaction()); showToast('Transaction added to your books.');
  }

  async function deleteTransaction() {
    if (!confirmDelete) return;
    if (demoMode) setLocalData((current) => ({ ...current, transactions: current.transactions.filter((item) => item.id !== confirmDelete) }));
    else if (supabase && currentUserId) { const { error } = await supabase.from('finance_transactions').delete().eq('id', confirmDelete).eq('user_id', currentUserId); if (error) { showToast(error.message); return; } await refreshData(currentUserId); }
    setConfirmDelete(null); showToast('Transaction deleted.');
  }

  async function deleteImport() {
    const batch = confirmImportDelete;
    if (!batch || importDeleteLoading) return;
    setImportDeleteLoading(true);
    try {
      if (demoMode) {
        setImportedData((current) => ({
          batches: current.batches.filter((item) => item.id !== batch.id),
          payments: current.payments.filter((item) => item.batch_id !== batch.id),
          payouts: current.payouts.filter((item) => item.batch_id !== batch.id),
          orders: current.orders.filter((item) => item.batch_id !== batch.id),
          products: current.products.filter((item) => item.batch_id !== batch.id),
          expenses: current.expenses.filter((item) => item.batch_id !== batch.id),
        }));
        setLocalData((current) => ({ ...current, transactions: current.transactions.filter((item) => item.import_batch_id !== batch.id) }));
      } else if (supabase && currentUserId) {
        await withTimeout(deleteImportedBatch(currentUserId, batch.id), 30000);
        await refreshData(currentUserId);
      }
      setConfirmImportDelete(null);
      showToast(`${batch.file_name} and its imported records were deleted.`);
    } catch (error) {
      showToast(describeError(error, 'Could not delete this imported file.'));
    } finally {
      setImportDeleteLoading(false);
    }
  }

  async function addAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name') || ''); const accountType = String(form.get('accountType') || 'bank') as FinanceAccount['account_type']; const opening = asMoneyString(String(form.get('balance') || '0'));
    if (!name) { showToast('Name your account first.'); return; }
    if (demoMode) setLocalData((current) => ({ ...current, accounts: [...current.accounts, { id: `demo-account-${Date.now()}`, user_id: 'demo', name, account_type: accountType, institution: String(form.get('institution') || '') || null, currency_code: DEFAULT_CURRENCY, current_balance: Number(opening), credit_limit: null, is_archived: false }] }));
    else if (supabase && currentUserId) { const { error } = await supabase.from('finance_accounts').insert({ user_id: currentUserId, name, account_type: accountType, institution: String(form.get('institution') || '') || null, current_balance: opening, opening_balance: opening, currency_code: DEFAULT_CURRENCY }); if (error) { showToast(error.message); return; } await refreshData(currentUserId); }
    else { showToast('Sign in to save accounts, or use the demo workspace.'); return; }
    setModal(null); showToast('Account added.');
  }

  async function addGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name') || ''); const target = asMoneyString(String(form.get('target') || '0')); const saved = asMoneyString(String(form.get('saved') || '0')); const targetDate = String(form.get('targetDate') || '') || null;
    if (!name || Number(target) <= 0) { showToast('Add a goal name and target amount.'); return; }
    const monthsRemaining = targetDate ? Math.max(1, Math.round((new Date(`${targetDate}T00:00:00`).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30))) : 0;
    const goal = { id: `demo-goal-${Date.now()}`, user_id: 'demo', name, target_amount: target, current_amount: saved, target_date: targetDate, suggested_monthly_saving: targetDate ? Math.max(0, Number(target) - Number(saved)) / monthsRemaining : 0, currency_code: DEFAULT_CURRENCY } as FinanceGoal;
    if (demoMode) setLocalData((current) => ({ ...current, goals: [...current.goals, goal] }));
    else if (supabase && currentUserId) { const { error } = await supabase.from('finance_goals').insert({ user_id: currentUserId, name, target_amount: target, current_amount: saved, target_date: targetDate, suggested_monthly_saving: goal.suggested_monthly_saving, currency_code: DEFAULT_CURRENCY }); if (error) { showToast(error.message); return; } await refreshData(currentUserId); }
    else { showToast('Sign in to save goals, or use the demo workspace.'); return; }
    setModal(null); showToast('Savings goal created.');
  }

  async function addBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const categoryId = String(form.get('categoryId') || '') || null; const category = activeData.categories.find((item) => item.id === categoryId); const amount = asMoneyString(String(form.get('amount') || '0')); if (Number(amount) <= 0) { showToast('Add a budget amount.'); return; }
    if (demoMode) setLocalData((current) => ({ ...current, budgets: [...current.budgets, { id: `demo-budget-${Date.now()}`, category_id: categoryId, name: category?.name || 'Monthly budget', month_start: monthStart(), amount, currency_code: DEFAULT_CURRENCY }] }));
    else if (supabase && currentUserId) { const { error } = await supabase.from('finance_budgets').insert({ user_id: currentUserId, category_id: categoryId, name: category?.name || 'Monthly budget', month_start: monthStart(), amount, currency_code: DEFAULT_CURRENCY }); if (error) { showToast(error.message); return; } await refreshData(currentUserId); }
    else { showToast('Sign in to save budgets, or use the demo workspace.'); return; }
    setModal(null); showToast('Budget added for this month.');
  }

  async function addBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name') || ''); const amount = asMoneyString(String(form.get('amount') || '0')); const dueDate = String(form.get('dueDate') || isoToday()); const paymentType = String(form.get('paymentType') || 'bill') as RecurringPayment['payment_type']; if (!name || Number(amount) <= 0) { showToast('Add a payment name and amount.'); return; }
    const bill = { id: `demo-bill-${Date.now()}`, name, payment_type: paymentType, amount, currency_code: DEFAULT_CURRENCY, next_due_date: dueDate, is_paid: false, cadence: String(form.get('cadence') || 'monthly') } as RecurringPayment;
    if (demoMode) setLocalData((current) => ({ ...current, recurring: [...current.recurring, bill] }));
    else if (supabase && currentUserId) { const { error } = await supabase.from('finance_recurring_payments').insert({ user_id: currentUserId, name, amount, next_due_date: dueDate, payment_type: paymentType, cadence: String(form.get('cadence') || 'monthly'), currency_code: DEFAULT_CURRENCY }); if (error) { showToast(error.message); return; } await refreshData(currentUserId); }
    else { showToast('Sign in to save payments, or use the demo workspace.'); return; }
    setModal(null); showToast('Recurring payment added.');
  }

  async function addInvestment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name') || ''); const type = String(form.get('type') || 'mutual_fund'); const invested = asMoneyString(String(form.get('invested') || '0')); const currentValue = asMoneyString(String(form.get('currentValue') || invested)); if (!name || Number(invested) <= 0) { showToast('Add an investment name and amount.'); return; }
    const investment = { id: `demo-investment-${Date.now()}`, name, investment_type: type, symbol: String(form.get('symbol') || '') || null, invested_amount: invested, current_value: currentValue, currency_code: DEFAULT_CURRENCY, as_of_date: isoToday() } as FinanceInvestment;
    if (demoMode) setLocalData((current) => ({ ...current, investments: [...current.investments, investment] }));
    else if (supabase && currentUserId) { const { error } = await supabase.from('finance_investments').insert({ user_id: currentUserId, name, investment_type: type, symbol: investment.symbol, invested_amount: invested, current_value: currentValue, currency_code: DEFAULT_CURRENCY, as_of_date: isoToday() }); if (error) { showToast(error.message); return; } await refreshData(currentUserId); }
    else { showToast('Sign in to save investments, or use the demo workspace.'); return; }
    setModal(null); showToast('Investment added to your portfolio.');
  }

  async function addLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const counterparty = String(form.get('counterparty') || ''); const direction = String(form.get('direction') || 'lent') as FinanceLoan['direction']; const principal = asMoneyString(String(form.get('principal') || '0')); const outstanding = asMoneyString(String(form.get('outstanding') || principal)); const dueDate = String(form.get('dueDate') || '') || null; const notes = String(form.get('notes') || '') || null;
    if (!counterparty || Number(principal) <= 0) { showToast('Add a person and principal amount.'); return; }
    const loan = { id: `demo-loan-${Date.now()}`, counterparty_name: counterparty, direction, principal, outstanding, currency_code: DEFAULT_CURRENCY, due_date: dueDate, status: 'open', notes } as FinanceLoan;
    if (demoMode) setLocalData((current) => ({ ...current, loans: [...current.loans, loan] }));
    else if (supabase && currentUserId) { const { error } = await supabase.from('finance_loans').insert({ user_id: currentUserId, counterparty_name: counterparty, direction, principal, outstanding, currency_code: DEFAULT_CURRENCY, due_date: dueDate, status: 'open', notes }); if (error) { showToast(error.message); return; } await refreshData(currentUserId); }
    else { showToast('Sign in to save lending entries, or use the demo workspace.'); return; }
    setModal(null); showToast('Lending entry added.');
  }

  async function addSplit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const participant = String(form.get('participant') || ''); const amount = asMoneyString(String(form.get('amount') || '0')); const direction = String(form.get('direction') || 'owed_to_me') as FinanceSplit['direction']; const transactionId = String(form.get('transactionId') || '') || null;
    if (!participant || Number(amount) <= 0) { showToast('Add a person and split amount.'); return; }
    const split = { id: `demo-split-${Date.now()}`, participant_name: participant, amount, direction, is_settled: false, transaction_id: transactionId } as FinanceSplit;
    if (demoMode) setLocalData((current) => ({ ...current, splits: [...current.splits, split] }));
    else if (supabase && currentUserId) { const { error } = await supabase.from('finance_splits').insert({ user_id: currentUserId, participant_name: participant, amount, direction, is_settled: false, transaction_id: transactionId }); if (error) { showToast(error.message); return; } await refreshData(currentUserId); }
    else { showToast('Sign in to save split expenses, or use the demo workspace.'); return; }
    setModal(null); showToast('Split expense added.');
  }

  async function markBillPaid(bill: RecurringPayment) {
    if (demoMode) setLocalData((current) => ({ ...current, recurring: current.recurring.map((item) => item.id === bill.id ? { ...item, is_paid: !item.is_paid } : item) }));
    else if (supabase && currentUserId) { const { error } = await supabase.from('finance_recurring_payments').update({ is_paid: !bill.is_paid }).eq('id', bill.id).eq('user_id', currentUserId); if (error) { showToast(error.message); return; } await refreshData(currentUserId); }
    showToast(bill.is_paid ? 'Payment marked as upcoming.' : 'Payment marked as paid.');
  }

  async function markNotificationsRead() {
    const unread = activeData.notifications.filter((notification) => !notification.is_read);
    if (!unread.length) { showToast('You are all caught up.'); setNotificationsOpen(false); return; }
    if (demoMode) {
      setLocalData((current) => ({ ...current, notifications: current.notifications.map((notification) => ({ ...notification, is_read: true })) }));
    } else if (supabase && currentUserId) {
      const { error } = await supabase.from('finance_notifications').update({ is_read: true }).eq('user_id', currentUserId).eq('is_read', false);
      if (error) { showToast(error.message); return; }
      await refreshData(currentUserId);
    }
    setNotificationsOpen(false);
    showToast(`${unread.length} notification${unread.length === 1 ? '' : 's'} marked as read.`);
  }

  function answerAssistant() {
    const question = assistantQuestion.toLowerCase();
    if (!question.trim()) return;
    if (question.includes('most') || question.includes('spend')) {
      const top = categorySpend[0]; setAssistantAnswer(top ? `You spend the most on ${top.name}: ${money(top.total)} in the current view. A small weekly cap there could make the biggest difference.` : 'I need a few expense transactions before I can spot your biggest category.');
    } else if (question.includes('compare') || question.includes('last month')) {
      setAssistantAnswer(`This month you have ${money(stats.income)} in and ${money(stats.expenses)} out. Your savings rate is ${stats.savingsRate}%. Add last month’s transactions to unlock a precise month-to-month comparison.`);
    } else if (question.includes('reduce') || question.includes('cut')) {
      const suggestions = categorySpend.slice(0, 2).map((item) => item.name).join(' and '); setAssistantAnswer(suggestions ? `Start with ${suggestions}. Set a small weekly limit, then review recurring payments before cutting essentials.` : 'Start by categorizing a few transactions; I’ll look for repeatable reductions.');
    } else if (question.includes('goal') || question.includes('long')) {
      const goal = activeData.goals[0]; const remaining = goal ? Math.max(0, number(goal.target_amount) - number(goal.current_amount)) : 0; const monthly = goal ? number(goal.suggested_monthly_saving) || Math.max(1, stats.savings * .25) : 0; setAssistantAnswer(goal ? `${goal.name} has ${money(remaining)} left. At ${money(monthly)} per month, you’re about ${Math.ceil(remaining / monthly)} months away.` : 'Create a savings goal and I’ll estimate the runway from your current savings pace.');
    } else setAssistantAnswer(`I can help with spending, comparisons, savings goals, and ways to reduce costs. Try “Where did I spend the most?”`);
  }

  function exportCsv() {
    const header = ['Date', 'Type', 'Merchant', 'Category', 'Account', 'Amount', 'Currency', 'Source'];
    const rows = activeData.transactions.map((transaction) => [transaction.transaction_date, transaction.type, transaction.merchant || '', transaction.finance_categories?.name || '', transaction.finance_accounts?.name || '', String(transaction.amount), transaction.currency_code, transaction.import_batch_id ? 'Imported' : 'Manual']);
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `gcs-books-${isoToday()}.csv`; anchor.click(); URL.revokeObjectURL(url); showToast('CSV report downloaded.');
  }

  if ((!session || passwordRecovery) && !demoMode) return <AuthScreen mode={authMode} passwordRecovery={passwordRecovery} onCancelRecovery={() => { setPasswordRecovery(false); setAuthMode('login'); setAuthError(''); setAuthMessage(''); setCanResendConfirmation(false); }} setMode={(mode) => { setAuthMode(mode); setAuthError(''); setAuthMessage(''); setCanResendConfirmation(false); }} email={authEmail} setEmail={setAuthEmail} password={authPassword} setPassword={setAuthPassword} name={authName} setName={setAuthName} message={authMessage} error={authError} loading={authLoading} canResendConfirmation={canResendConfirmation} resendLoading={resendLoading} emailCooldownSeconds={emailCooldownSeconds} onResendConfirmation={resendConfirmation} onSubmit={handleAuth} onDemo={startDemo} />;
  if (loading && !demoMode) return <LoadingScreen />;

  const currentView = views.find((item) => item.id === view) || views[0];
  const realtimeLabel = demoMode ? 'Demo data only' : realtimeStatusLabels[realtimeStatus];
  return (
    <div className={`finance-app ${darkMode ? 'dark' : ''}`}>
      <Sidebar view={view} setView={(next) => { setView(next); setSidebarOpen(false); }} open={sidebarOpen} onClose={() => setSidebarOpen(false)} onAssistant={() => setAssistantOpen(true)} onLogout={logout} userName={userName} demoMode={demoMode} supabaseProjectRef={supabaseProjectRef} billCount={activeData.recurring.filter((bill) => !bill.is_paid).length} />
      <div className="finance-main">
        <header className="finance-topbar"><div className="finance-topbar-left"><button type="button" className="mobile-nav-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">☰</button><div><h1>{view === 'overview' ? `Good morning, ${userName}` : currentView.label}</h1><span className={`finance-realtime-status ${demoMode ? 'demo' : realtimeStatus}`} role="status" title={realtimeMessage || realtimeLabel}><i aria-hidden="true" />{realtimeLabel}</span></div></div><div className="finance-topbar-actions"><div className="top-search"><span>⌕</span><input ref={globalSearchRef} aria-label="Search transactions" placeholder="Search your books" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && search.trim()) setView('transactions'); }} /><kbd>⌘K</kbd></div><button type="button" className="top-icon-button" aria-label="Toggle dark mode" onClick={() => setDarkMode((current) => !current)}>{darkMode ? '☼' : '☾'}</button><button type="button" className="top-icon-button notification-trigger" aria-label="Open notifications" onClick={() => setNotificationsOpen((current) => !current)}>♢{activeData.notifications.some((item) => !item.is_read) && <i />}</button><div className="finance-avatar">{userName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div></div>{notificationsOpen && <NotificationPanel notifications={activeData.notifications} onClose={() => setNotificationsOpen(false)} onMarkAllRead={markNotificationsRead} />}</header>
        <main className="finance-content"><div className="content-toolbar"><div><span className="content-eyebrow">{view === 'overview' ? longDateLabel(today) : 'Your financial command center'}</span>{view !== 'overview' && <p className="content-subtitle">Everything you need to make calmer money decisions.</p>}</div><div className="content-actions"><button type="button" className="secondary-button" onClick={() => setAssistantOpen(true)}><span>✦</span> Ask assistant</button><button type="button" className="primary-button" onClick={() => { setTransactionForm({ ...newTransaction(), accountId: activeData.accounts[0]?.id || '', categoryId: activeData.categories.find((item) => item.kind !== 'income')?.id || '' }); setModal('transaction'); }}>+ Add transaction</button></div></div>{dataError && <div className="data-error"><span>!</span>{dataError}<button type="button" onClick={() => currentUserId && refreshData(currentUserId)}>Retry</button></div>}<ImportContextRibbon analysis={importedAnalysis} batches={importedData.batches} onOpen={() => setView('imports')} />{renderView(view, activeData, stats, categorySpend, smartInsights, filteredTransactions, search, transactionFilter, transactionSourceFilter, setSearch, setTransactionFilter, setTransactionSourceFilter, setView, setModal, setTransactionForm, markBillPaid, setConfirmDelete, setConfirmImportDelete, showToast, exportCsv, importedData, handleImportFiles, importLoading, importError, importMessage, handleShopifyImport, shopifySyncLoading, shopifySyncError, shopifySyncMessage)}</main>
      </div>
      {assistantOpen && <AssistantPanel question={assistantQuestion} setQuestion={setAssistantQuestion} answer={assistantAnswer} onAsk={answerAssistant} onClose={() => setAssistantOpen(false)} />}
      {modal === 'transaction' && <TransactionModal form={transactionForm} setForm={setTransactionForm} accounts={activeData.accounts} categories={activeData.categories} onSubmit={addTransaction} onClose={() => setModal(null)} />}
      {modal === 'account' && <SimpleModal title="Add account" description="Keep every balance visible in one place." onSubmit={addAccount} onClose={() => setModal(null)} submitLabel="Add account"><Field label="Account name" name="name" placeholder="HDFC Salary Account" required /><div className="form-grid"><Field label="Institution" name="institution" placeholder="HDFC Bank" /><SelectField label="Type" name="accountType" options={['bank', 'cash', 'wallet', 'credit_card', 'savings', 'investment', 'other']} /></div><Field label="Current balance" name="balance" type="number" placeholder="0.00" /></SimpleModal>}
      {modal === 'budget' && <SimpleModal title="Set a monthly budget" description="A soft guardrail is more useful than a rigid rule." onSubmit={addBudget} onClose={() => setModal(null)} submitLabel="Set budget"><SelectField label="Category" name="categoryId" options={activeData.categories.filter((item) => item.kind !== 'income').map((item) => item.id)} labels={activeData.categories.filter((item) => item.kind !== 'income').map((item) => item.name)} /><Field label="Monthly limit" name="amount" type="number" placeholder="10000" required /></SimpleModal>}
      {modal === 'goal' && <SimpleModal title="Create a savings goal" description="Turn a good intention into a visible plan." onSubmit={addGoal} onClose={() => setModal(null)} submitLabel="Create goal"><Field label="Goal name" name="name" placeholder="Emergency fund" required /><div className="form-grid"><Field label="Target amount" name="target" type="number" placeholder="300000" required /><Field label="Already saved" name="saved" type="number" placeholder="0" /></div><Field label="Target date" name="targetDate" type="date" /></SimpleModal>}
      {modal === 'bill' && <SimpleModal title="Add recurring payment" description="See the next due date before it surprises you." onSubmit={addBill} onClose={() => setModal(null)} submitLabel="Add payment"><Field label="Payment name" name="name" placeholder="Notion Plus" required /><div className="form-grid"><Field label="Amount" name="amount" type="number" placeholder="800" required /><SelectField label="Type" name="paymentType" options={['bill', 'subscription', 'emi', 'recurring']} /></div><div className="form-grid"><Field label="Next due date" name="dueDate" type="date" /><SelectField label="Cadence" name="cadence" options={['weekly', 'monthly', 'quarterly', 'yearly']} /></div></SimpleModal>}
      {modal === 'investment' && <SimpleModal title="Add investment" description="Track invested capital alongside current value." onSubmit={addInvestment} onClose={() => setModal(null)} submitLabel="Add investment"><Field label="Investment name" name="name" placeholder="Nifty 50 Index Fund" required /><div className="form-grid"><SelectField label="Type" name="type" options={['stock', 'mutual_fund', 'sip', 'gold', 'fd', 'crypto', 'bond', 'other']} /><Field label="Symbol (optional)" name="symbol" placeholder="NIFTY50" /></div><div className="form-grid"><Field label="Invested amount" name="invested" type="number" placeholder="82000" required /><Field label="Current value" name="currentValue" type="number" placeholder="94650" /></div></SimpleModal>}
      {modal === 'loan' && <SimpleModal title="Add lending entry" description="Keep lent and borrowed money clear without making it awkward." onSubmit={addLoan} onClose={() => setModal(null)} submitLabel="Add lending entry"><Field label="Person or counterparty" name="counterparty" placeholder="Aarav" required /><div className="form-grid"><SelectField label="Direction" name="direction" options={['lent', 'borrowed']} /><Field label="Due date" name="dueDate" type="date" /></div><div className="form-grid"><Field label="Principal" name="principal" type="number" placeholder="12000" required /><Field label="Outstanding" name="outstanding" type="number" placeholder="6500" /></div><Field label="Note" name="notes" placeholder="Laptop repair" /></SimpleModal>}
      {modal === 'split' && <SimpleModal title="Add split expense" description="Track who owes what from a shared meal, trip, or household cost." onSubmit={addSplit} onClose={() => setModal(null)} submitLabel="Add split"><Field label="Participant" name="participant" placeholder="Mira" required /><div className="form-grid"><Field label="Amount" name="amount" type="number" placeholder="1450" required /><SelectField label="Direction" name="direction" options={['owed_to_me', 'i_owe']} /></div><Field label="Transaction ID (optional)" name="transactionId" placeholder="txn-123" /></SimpleModal>}
      {confirmDelete && <ConfirmDialog title="Delete this transaction?" body="This will remove the record from your books. This action cannot be undone." onCancel={() => setConfirmDelete(null)} onConfirm={deleteTransaction} />}
      {confirmImportDelete && <ConfirmDialog title="Delete this imported file?" body={`This will remove ${confirmImportDelete.file_name} and all records imported from it. Manual transactions will stay untouched.`} onCancel={() => { if (!importDeleteLoading) setConfirmImportDelete(null); }} onConfirm={deleteImport} confirmLabel={importDeleteLoading ? 'Deleting…' : 'Delete file'} disabled={importDeleteLoading} />}
      {toast && <div className="finance-toast"><span>✓</span>{toast}</div>}
    </div>
  );
}

function renderView(view: View, data: FinanceData, stats: { balance: number; income: number; expenses: number; savings: number; investmentValue: number; savingsRate: number }, categorySpend: { name: string; color: string; total: number }[], insights: { kind: string; title: string; body: string; icon: string }[], filteredTransactions: FinanceTransaction[], search: string, transactionFilter: 'all' | 'income' | 'expense' | 'transfer', transactionSourceFilter: TransactionSourceFilter, setSearch: (value: string) => void, setTransactionFilter: (value: 'all' | 'income' | 'expense' | 'transfer') => void, setTransactionSourceFilter: (value: TransactionSourceFilter) => void, setView: (value: View) => void, setModal: (value: Modal) => void, setTransactionForm: (value: TransactionForm) => void, markBillPaid: (bill: RecurringPayment) => void, setConfirmDelete: (value: string | null) => void, setConfirmImportDelete: (value: FinanceImportBatch | null) => void, showToast: (value: string) => void, exportCsv: () => void, importedData: ImportData, onImportFiles: (files: File[]) => Promise<boolean>, importLoading: boolean, importError: string, importMessage: string, onShopifyImport: (period: ShopifyImportPeriod) => Promise<boolean>, shopifySyncLoading: boolean, shopifySyncError: string, shopifySyncMessage: string) {
  switch (view) {
    case 'transactions': return <TransactionsView data={data} transactions={filteredTransactions} search={search} filter={transactionFilter} sourceFilter={transactionSourceFilter} setSearch={setSearch} setFilter={setTransactionFilter} setSourceFilter={setTransactionSourceFilter} setModal={setModal} setTransactionForm={setTransactionForm} setConfirmDelete={setConfirmDelete} />;
    case 'accounts': return <AccountsView data={data} setModal={setModal} />;
    case 'budgets': return <BudgetsView data={data} setModal={setModal} />;
    case 'goals': return <GoalsView data={data} setModal={setModal} />;
    case 'bills': return <BillsView data={data} setModal={setModal} markBillPaid={markBillPaid} />;
    case 'investments': return <InvestmentsView data={data} setModal={setModal} />;
    case 'analytics': return <AnalyticsView data={data} stats={stats} categorySpend={categorySpend} importedData={importedData} setView={setView} />;
    case 'lending': return <LendingView data={data} setModal={setModal} />;
    case 'reports': return <ReportsView data={data} importedData={importedData} exportCsv={exportCsv} setView={setView} />;
    case 'calendar': return <CalendarView data={data} importedData={importedData} />;
    case 'imports': return <ImportCenterView importedData={importedData} onImportFiles={onImportFiles} onShopifyImport={onShopifyImport} onDeleteBatch={setConfirmImportDelete} loading={importLoading} error={importError} message={importMessage} shopifySyncLoading={shopifySyncLoading} shopifySyncError={shopifySyncError} shopifySyncMessage={shopifySyncMessage} />;
    default: return <OverviewView data={data} stats={stats} categorySpend={categorySpend} insights={insights} setView={setView} setModal={setModal} />;
  }
}

function ImportContextRibbon({ analysis, batches, onOpen }: { analysis: ImportAnalysis; batches: FinanceImportBatch[]; onOpen: () => void }) {
  const reviewCount = batches.reduce((sum, batch) => sum + (batch.review_count || 0), 0);
  const hasData = batches.length > 0;
  const latestBatch = batches[0];
  const healthCopy = analysis.pnlReady
    ? `Holistic Shopify P&L is ready. ${analysis.cogsUnmatchedUnits ? `${analysis.cogsUnmatchedUnits} units still need a product cost match.` : 'COGS coverage is complete.'}`
    : `P&L pack is incomplete: ${analysis.pnlMissingExports.join(', ')}.${reviewCount ? ` ${reviewCount} row${reviewCount === 1 ? '' : 's'} need review.` : ''}`;
  return <section className={`import-context-ribbon ${hasData ? 'has-data' : 'is-empty'}`} aria-label="Import data connection">
    <div className="import-context-icon">⇵</div>
    <div className="import-context-copy"><span className="content-eyebrow">Connected Shopify data</span><strong>{hasData ? `${analysis.totalRows.toLocaleString()} source rows are flowing through this workspace` : 'Connect your Shopify export pack to every view'}</strong><p>{hasData ? `${healthCopy}${latestBatch ? ` Latest source: ${latestBatch.file_name}.` : ''}` : 'Orders, product costs, payments, payouts, and operating expenses power your ledger, P&L, reports, analytics, and calendar.'}</p></div>
    {hasData && <div className="import-context-stats"><div><span>Net sales</span><strong>{moneyExact(analysis.netSales, analysis.currency)}</strong></div><div><span>Est. profit</span><strong>{moneyExact(analysis.estimatedOperatingProfit, analysis.currency)}</strong></div><div><span>Source files</span><strong>{batches.length}</strong></div></div>}
    <button className="import-context-action" type="button" onClick={onOpen}>{hasData ? 'Review Shopify imports' : 'Import Shopify exports'} <span>↗</span></button>
  </section>;
}

function ShopifyPnlSummary({ analysis, compact = false }: { analysis: ImportAnalysis; compact?: boolean }) {
  const signedMoney = (value: number) => `${value < 0 ? '−' : ''}${moneyExact(Math.abs(value), analysis.currency)}`;
  const profitTone = analysis.estimatedOperatingProfit >= 0 ? 'positive' : 'negative';
  return <section className={`shopify-pnl-card ${compact ? 'compact' : ''}`} aria-label="Shopify profit and loss summary">
    <div className="pnl-header"><div><span className="content-eyebrow">Shopify P&L</span><h3>Holistic profit & loss</h3><p>Sales, product costs, processor fees, and operating expenses in one accrual view.</p></div><span className={`pnl-status ${analysis.pnlReady ? 'ready' : 'incomplete'}`}>{analysis.pnlReady ? 'P&L ready' : `${5 - analysis.pnlMissingExports.length}/5 exports`}</span></div>
    {!analysis.pnlReady && <div className="pnl-incomplete"><strong>Complete the five-file Shopify pack for a decision-ready P&L.</strong><div className="pnl-missing">{analysis.pnlMissingExports.map((item) => <span key={item}>＋ {item}</span>)}</div></div>}
    <div className="pnl-grid"><div className="pnl-metric"><span>Net sales</span><strong>{moneyExact(analysis.netSales, analysis.currency)}</strong><small>Gross sales less discounts and returns</small></div><div className="pnl-metric"><span>COGS</span><strong>−{moneyExact(analysis.cogs, analysis.currency)}</strong><small>{analysis.cogsMatchedUnits.toLocaleString()} units matched to cost</small></div><div className="pnl-metric"><span>Payment fees</span><strong>−{moneyExact(analysis.paymentFees, analysis.currency)}</strong><small>{analysis.paymentRows.toLocaleString()} payment rows</small></div><div className="pnl-metric"><span>Operating expenses</span><strong>−{moneyExact(analysis.operatingExpenses, analysis.currency)}</strong><small>{analysis.expenseRows.toLocaleString()} expense rows</small></div><div className={`pnl-metric highlight ${profitTone}`}><span>Estimated operating profit</span><strong>{signedMoney(analysis.estimatedOperatingProfit)}</strong><small>Net sales + shipping − COGS − fees − expenses</small></div></div>
    <div className="pnl-detail-row"><span>Gross sales <strong>{moneyExact(analysis.grossSales, analysis.currency)}</strong></span><span>Shipping revenue <strong>{moneyExact(analysis.shippingRevenue, analysis.currency)}</strong></span><span>Taxes collected <strong>{moneyExact(analysis.taxesCollected, analysis.currency)}</strong></span><span>Returns <strong>−{moneyExact(analysis.returnsAmount, analysis.currency)}</strong></span></div>
    {(analysis.cogsUnmatchedUnits > 0 || analysis.payoutRows > 0) && <p className="pnl-note">{analysis.cogsUnmatchedUnits > 0 ? `${analysis.cogsUnmatchedUnits.toLocaleString()} units have no matching SKU cost, so COGS and profit are understated until the product export is completed. ` : ''}{analysis.payoutRows > 0 ? 'Payouts reconcile cash timing; they are kept separate from revenue.' : ''}</p>}
  </section>;
}

function AuthScreen({ mode, passwordRecovery, onCancelRecovery, setMode, email, setEmail, password, setPassword, name, setName, message, error, loading, canResendConfirmation, resendLoading, emailCooldownSeconds, onResendConfirmation, onSubmit, onDemo }: { mode: AuthMode; passwordRecovery: boolean; onCancelRecovery: () => void; setMode: (mode: AuthMode) => void; email: string; setEmail: (value: string) => void; password: string; setPassword: (value: string) => void; name: string; setName: (value: string) => void; message: string; error: string; loading: boolean; canResendConfirmation: boolean; resendLoading: boolean; emailCooldownSeconds: number; onResendConfirmation: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onDemo: () => void }) {
  const reset = mode === 'reset'; const signup = mode === 'signup'; const recovery = reset && passwordRecovery;
   return <main className="auth-shell"><div className="auth-glow auth-glow-one" /><section className="auth-story"><div className="auth-brand-lockup"><div className="brand-mark"><span>G</span></div><div><div className="brand-name">GCS Books</div><div className="brand-subtitle">Global Creative Services</div></div></div><div className="auth-story-copy"><div className="eyebrow auth-eyebrow">Your calmer money practice</div><h1>Know your numbers. Keep your options open.</h1><p>Accounts, bills, goals, and investments in one secure, human workspace built for real life.</p></div><div className="auth-proof-row"><div><strong>{DEFAULT_CURRENCY} first</strong><span>multi-currency ready</span></div><div><strong>Private</strong><span>row-level protected</span></div></div></section><section className="auth-card-wrap"><div className="auth-card-topline"><span>GCS Books</span><span><i className="secure-dot" /> Secure workspace</span></div><div className="auth-card"><div className="auth-card-header"><div className="auth-mini-mark">G</div><div className="eyebrow">{recovery ? 'Set a new password' : reset ? 'Account recovery' : signup ? 'Start with a clean slate' : 'Welcome back'}</div><h2>{recovery ? 'Create a new password' : reset ? 'Reset your password' : signup ? 'Create your workspace' : 'Sign in to your books'}</h2><p>{recovery ? 'Choose a strong password to keep your workspace secure.' : reset ? 'We will send a secure reset link to your email.' : signup ? 'Set up your financial home in under two minutes.' : 'Your numbers are ready when you are.'}</p></div>{!reset && <div className="auth-mode-toggle"><button className={!signup ? 'selected' : ''} type="button" onClick={() => setMode('login')}>Sign in</button><button className={signup ? 'selected' : ''} type="button" onClick={() => setMode('signup')}>Create account</button></div>}<form className="auth-form" onSubmit={onSubmit}>{signup && <label className="auth-field"><span>Your name</span><input autoComplete="name" placeholder="Shadma Mittal" value={name} onChange={(event) => setName(event.target.value)} /></label>}{!recovery && <label className="auth-field"><span>Work email</span><input type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>}{(!reset || recovery) && <label className="auth-field"><span>Password</span><input type="password" autoComplete={signup || recovery ? 'new-password' : 'current-password'} placeholder={recovery ? 'Choose a new password' : 'Enter your password'} value={password} onChange={(event) => setPassword(event.target.value)} /></label>}{error && <div className="auth-message"><span>!</span>{error}</div>}{canResendConfirmation && <button className="auth-resend" type="button" disabled={resendLoading || emailCooldownSeconds > 0} onClick={onResendConfirmation}>{resendLoading ? 'Sending confirmation email…' : emailCooldownSeconds > 0 ? `Try again in ${formatCooldown(emailCooldownSeconds)}` : 'Resend confirmation email'}</button>}{message && <div className="auth-success"><span>✓</span>{message}</div>}<button className="auth-submit" disabled={loading || resendLoading} type="submit">{loading ? 'Working…' : recovery ? 'Update password' : reset ? 'Send reset link' : signup ? 'Create my workspace' : 'Sign in to workspace'}<span>↗</span></button></form>{!reset && <><div className="auth-divider"><span>or</span></div><button className="demo-button" type="button" onClick={onDemo}><span className="demo-icon">✦</span><span><strong>Preview demo workspace</strong><small>Explore the dashboard with sample data</small></span><span className="demo-arrow">↗</span></button></>}<p className="auth-switch">{reset ? <button type="button" onClick={passwordRecovery ? onCancelRecovery : () => setMode('login')}>← Back to sign in</button> : <><button type="button" onClick={() => setMode(signup ? 'login' : 'reset')}>{signup ? 'Already have an account? Sign in' : 'Forgot password?'}</button></>}</p></div><div className="auth-card-footer"><span>◈ Your data stays yours.</span><span>Privacy · Terms</span></div></section></main>;
}

function LoadingScreen() { return <main className="loading-screen"><div className="loading-mark">G</div><div className="loading-line" /><p>Loading your money picture…</p></main>; }

function Sidebar({ view, setView, open, onClose, onAssistant, onLogout, userName, demoMode, supabaseProjectRef, billCount }: { view: View; setView: (view: View) => void; open: boolean; onClose: () => void; onAssistant: () => void; onLogout: () => void; userName: string; demoMode: boolean; supabaseProjectRef: string | null; billCount: number }) {
  const groups = [...new Set(views.map((item) => item.group))];
  return <><div className={`sidebar-scrim ${open ? 'show' : ''}`} onClick={onClose} /><aside className={`finance-sidebar ${open ? 'open' : ''}`}><div className="finance-brand"><div className="brand-mark"><span>G</span></div><div><strong>GCS Books</strong><small>Personal finance</small></div></div><button className="workspace-switcher" type="button"><span className="workspace-avatar">{userName.slice(0, 2).toUpperCase()}</span><span><strong>{demoMode ? 'Demo workspace' : `${userName}'s finances`}</strong><small><i className={`connection-dot ${demoMode ? 'demo' : 'synced'}`} /> {demoMode ? `Demo data · ${DEFAULT_CURRENCY} ($)` : `Synced · ${DEFAULT_CURRENCY} ($)${supabaseProjectRef ? ` · ${supabaseProjectRef}` : ''}`}</small></span><span>⌄</span></button><div className="side-scroll">{groups.map((group) => <div className="side-group" key={group}><div className="side-label">{group}</div>{views.filter((item) => item.group === group).map((item) => <button type="button" key={item.id} className={`side-item ${view === item.id ? 'active' : ''}`} onClick={() => setView(item.id)}><span>{item.icon}</span>{item.label}{item.id === 'bills' && billCount > 0 && <i className="side-count">{billCount}</i>}</button>)}</div>)}</div><button className="assistant-cta" type="button" onClick={onAssistant}><span>✦</span><span><strong>Finance assistant</strong><small>Ask about your money</small></span><b>↗</b></button><div className="side-user"><div className="finance-avatar">{userName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div><span><strong>{userName}</strong><small>{demoMode ? 'Demo mode' : 'Signed in'}</small></span><button type="button" aria-label="Sign out" onClick={onLogout}>↪</button></div></aside></>;
}

function OverviewView({ data, stats, categorySpend, insights, setView, setModal }: { data: FinanceData; stats: { balance: number; income: number; expenses: number; savings: number; investmentValue: number; savingsRate: number }; categorySpend: { name: string; color: string; total: number }[]; insights: { kind: string; title: string; body: string; icon: string }[]; setView: (view: View) => void; setModal: (modal: Modal) => void }) {
  const maxBar = Math.max(...data.transactions.map((item) => number(item.amount)), 1);
  return <div className="view-stack"><section className="insight-strip"><div className="insight-symbol">✦</div><div><strong>{stats.savingsRate >= 20 ? 'Your money picture is looking healthy.' : 'A small review today can create breathing room.'}</strong><p>You are saving {stats.savingsRate}% of your income in this view.</p></div><button type="button" onClick={() => setView('analytics')}>See the story ↗</button></section><section className="kpi-grid"><KpiCard label="Total balance" value={money(stats.balance)} meta="across all accounts" tone="green" symbol="◈" /><KpiCard label="Income this month" value={money(stats.income)} meta="money in" tone="blue" symbol="↙" /><KpiCard label="Expenses this month" value={money(stats.expenses)} meta="money out" tone="orange" symbol="↗" /><KpiCard label="Savings rate" value={`${stats.savingsRate}%`} meta={`${money(stats.savings)} saved`} tone="violet" symbol="◎" /></section><div className="overview-grid"><section className="finance-card cash-card"><CardHeading eyebrow="Flow" title="Income vs expenses" action="Analytics" onAction={() => setView('analytics')} /><div className="chart-meta"><span><i className="legend-income" /> Income</span><span><i className="legend-expense" /> Expenses</span><strong>{money(stats.savings)} net savings</strong></div><div className="flow-chart">{[1, 2, 3, 4, 5, 6].map((index) => { const income = data.transactions.filter((item) => item.type === 'income')[index - 1]?.amount || (index === 6 ? stats.income : 0); const expense = data.transactions.filter((item) => item.type === 'expense')[index - 1]?.amount || (index === 6 ? stats.expenses : 0); return <div className="flow-column" key={index}><div className="flow-bars"><span className="income-bar" style={{ height: `${Math.max(10, number(income) / maxBar * 100)}%` }} /><span className="expense-bar" style={{ height: `${Math.max(8, number(expense) / maxBar * 100)}%` }} /></div><small>{['Mar', 'Apr', 'May', 'Jun', 'Jul', monthLabel(today).split(' ')[0].slice(0, 3)][index - 1]}</small></div>; })}</div></section><section className="finance-card category-card"><CardHeading eyebrow="Where it goes" title="Spending by category" action="Details" onAction={() => setView('analytics')} /><div className="donut-wrap"><div className="donut" style={{ background: categorySpend.length ? `conic-gradient(${categorySpend.slice(0, 4).map((item, index) => `${item.color} ${index * 25}% ${(index + 1) * 25}%`).join(', ')}` : '#e9efe8' }}><div><strong>{money(stats.expenses)}</strong><small>spent</small></div></div><div className="category-list">{categorySpend.slice(0, 4).map((item) => <div key={item.name}><span><i style={{ background: item.color }} />{item.name}</span><strong>{Math.round(item.total / Math.max(stats.expenses, 1) * 100)}%</strong></div>)}</div></div></section></div><div className="overview-grid lower"><section className="finance-card"><CardHeading eyebrow="Coming up" title="Bills & subscriptions" action="View all" onAction={() => setView('bills')} /><div className="bill-list">{data.recurring.slice(0, 3).map((bill) => <div className="bill-row" key={bill.id}><div className="bill-icon">{bill.payment_type === 'subscription' ? '◉' : bill.payment_type === 'emi' ? '↗' : '□'}</div><div><strong>{bill.name}</strong><small>{dateLabel(bill.next_due_date)} · {bill.cadence}</small></div><strong className="bill-amount">{money(bill.amount)}</strong><span className={`bill-status ${bill.is_paid ? 'paid' : ''}`}>{bill.is_paid ? 'Paid' : 'Due'}</span></div>)}{!data.recurring.length && <EmptyState title="No upcoming payments" body="Add rent, EMIs, subscriptions, and more." action="Add payment" onAction={() => setModal('bill')} />}</div></section><section className="finance-card"><CardHeading eyebrow="Goals" title="Savings progress" action="Manage" onAction={() => setView('goals')} /><div className="goal-mini-list">{data.goals.slice(0, 2).map((goal) => <div className="goal-mini" key={goal.id}><div className="goal-mini-top"><span><i className="goal-dot" />{goal.name}</span><strong>{Math.round(number(goal.current_amount) / Math.max(number(goal.target_amount), 1) * 100)}%</strong></div><div className="progress-track"><span style={{ width: `${Math.min(100, number(goal.current_amount) / Math.max(number(goal.target_amount), 1) * 100)}%` }} /></div><small>{money(goal.current_amount)} of {money(goal.target_amount)} · {money(goal.suggested_monthly_saving)}/mo suggested</small></div>)}{!data.goals.length && <EmptyState title="Give your next goal a name" body="Build a travel fund, emergency buffer, or anything in between." action="Create goal" onAction={() => setModal('goal')} />}</div></section></div><section className="finance-card insight-card"><CardHeading eyebrow="Smart insights" title="Small observations, useful next steps" action="Analytics" onAction={() => setView('analytics')} /><div className="insight-grid">{insights.map((insight) => <div className={`smart-insight ${insight.kind}`} key={insight.title}><span>{insight.icon}</span><div><strong>{insight.title}</strong><p>{insight.body}</p></div></div>)}</div></section><section className="finance-card recent-card"><CardHeading eyebrow="Latest activity" title="Recent transactions" action="See all" onAction={() => setView('transactions')} /><TransactionTable transactions={data.transactions.slice(0, 5)} onDelete={() => undefined} showActions={false} /></section></div>;
}

function KpiCard({ label, value, meta, tone, symbol }: { label: string; value: string; meta: string; tone: string; symbol: string }) { return <article className="kpi-card"><div className={`kpi-symbol ${tone}`}>{symbol}</div><span>{label}</span><strong>{value}</strong><small>{meta}</small></article>; }
function CardHeading({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action?: string; onAction?: () => void }) { return <div className="card-heading"><div><span>{eyebrow}</span><h2>{title}</h2></div>{action && <button type="button" onClick={onAction}>{action} ↗</button>}</div>; }
function EmptyState({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) { return <div className="empty-state"><div className="empty-symbol">◌</div><strong>{title}</strong><p>{body}</p>{action && <button type="button" onClick={onAction}>{action} +</button>}</div>; }

function TransactionsView({ data, transactions, search, filter, sourceFilter, setSearch, setFilter, setSourceFilter, setModal, setTransactionForm, setConfirmDelete }: { data: FinanceData; transactions: FinanceTransaction[]; search: string; filter: 'all' | 'income' | 'expense' | 'transfer'; sourceFilter: TransactionSourceFilter; setSearch: (value: string) => void; setFilter: (value: 'all' | 'income' | 'expense' | 'transfer') => void; setSourceFilter: (value: TransactionSourceFilter) => void; setModal: (modal: Modal) => void; setTransactionForm: (form: TransactionForm) => void; setConfirmDelete: (id: string | null) => void }) {
  const incomeCategories = data.categories.filter((item) => item.kind === 'income');
  const expenseCategories = data.categories.filter((item) => item.kind !== 'income');
  return <div className="view-stack"><section className="module-header"><div><span className="content-eyebrow">Your money, item by item</span><h2>Transactions</h2><p>Search, filter, and keep the details tidy.</p></div><button type="button" className="primary-button" onClick={() => { setTransactionForm({ ...newTransaction(), accountId: data.accounts[0]?.id || '', categoryId: expenseCategories[0]?.id || incomeCategories[0]?.id || '' }); setModal('transaction'); }}>+ Add transaction</button></section><section className="finance-card"><div className="filter-bar"><div className="inline-search"><span>⌕</span><input aria-label="Search transaction details" placeholder="Search merchant, category, or tag" value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="filter-pills">{(['all', 'income', 'expense', 'transfer'] as const).map((item) => <button type="button" className={filter === item ? 'active' : ''} key={item} onClick={() => setFilter(item)}>{item === 'all' ? 'All activity' : item[0].toUpperCase() + item.slice(1)}</button>)}</div><label className="source-filter"><span>Source</span><select aria-label="Filter by transaction source" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as TransactionSourceFilter)}><option value="all">All sources</option><option value="manual">Manual only</option><option value="imported">Imported only</option></select></label></div><TransactionTable transactions={transactions} onDelete={setConfirmDelete} /><p className="table-footnote">Showing {transactions.length} of {data.transactions.length} transactions · {sourceFilter === 'imported' ? 'Imported records are linked to their source file.' : sourceFilter === 'manual' ? 'Imported records are hidden.' : 'Amounts are stored as exact decimal values.'}</p></section></div>;
}

function TransactionTable({ transactions, onDelete, showActions = true }: { transactions: FinanceTransaction[]; onDelete: (id: string) => void; showActions?: boolean }) { return <div className="transaction-table"><div className="transaction-head"><span>Transaction</span><span>Account</span><span>Date</span><span>Amount</span><span /></div>{transactions.map((transaction) => <div className="transaction-row" key={transaction.id}><div className="transaction-name"><span className={`transaction-icon ${transaction.type}`}>{transaction.type === 'income' ? '↙' : transaction.type === 'transfer' ? '⇄' : transaction.finance_categories?.icon || '◒'}</span><span><strong>{transaction.merchant || transaction.description || 'Untitled transaction'}</strong><small>{transaction.finance_categories?.name || 'Uncategorized'} {transaction.tags.length ? `· ${transaction.tags.join(', ')}` : ''} <em className={`source-label ${transaction.import_batch_id ? 'imported' : 'manual'}`}>{transaction.import_batch_id ? 'Imported' : 'Manual'}</em></small></span></div><span className="transaction-account">{transaction.finance_accounts?.name || '—'}</span><span className="transaction-date">{dateLabel(transaction.transaction_date)}</span><strong className={`transaction-amount ${transaction.type}`}>{transaction.type === 'expense' ? '−' : '+'}{moneyExact(transaction.amount, transaction.currency_code)}</strong>{showActions ? <button className="row-menu" type="button" aria-label={`Delete ${transaction.merchant || 'transaction'}`} onClick={() => onDelete(transaction.id)}>•••</button> : <span className="row-menu-spacer" aria-hidden="true" />}</div>)}{!transactions.length && <EmptyState title="No matching transactions" body="Add your first income or expense to start seeing patterns." />}</div>; }

function AccountsView({ data, setModal }: { data: FinanceData; setModal: (modal: Modal) => void }) { const total = data.accounts.reduce((sum, account) => sum + number(account.current_balance), 0); return <div className="view-stack"><section className="module-header"><div><span className="content-eyebrow">One picture, every pocket</span><h2>Accounts</h2><p>{data.accounts.length} connected accounts · {money(total)} total balance</p></div><button type="button" className="primary-button" onClick={() => setModal('account')}>+ Add account</button></section><section className="account-grid">{data.accounts.map((account) => <article className={`account-card ${account.account_type}`} key={account.id}><div className="account-card-top"><span className="account-type-icon">{account.account_type === 'credit_card' ? '▱' : account.account_type === 'cash' ? '◌' : account.account_type === 'wallet' ? '▣' : '▤'}</span><button type="button" aria-label={`More options for ${account.name}`}>•••</button></div><span>{account.institution || account.account_type.replace('_', ' ')}</span><h3>{account.name}</h3><strong>{moneyExact(account.current_balance, account.currency_code)}</strong><small>{account.account_type === 'credit_card' ? `of ${money(account.credit_limit)} limit` : account.currency_code}</small></article>)}{!data.accounts.length && <div className="wide-empty"><EmptyState title="Connect your first account" body="Start with a bank, cash wallet, credit card, or savings account." action="Add account" onAction={() => setModal('account')} /></div>}</section></div>; }

function BudgetsView({ data, setModal }: { data: FinanceData; setModal: (modal: Modal) => void }) { return <div className="view-stack"><section className="module-header"><div><span className="content-eyebrow">Give your money a job</span><h2>Budgets</h2><p>Monthly guardrails that adapt to real life.</p></div><button className="primary-button" onClick={() => setModal('budget')}>+ Set budget</button></section><section className="budget-grid">{data.budgets.map((budget) => { const used = data.transactions.filter((t) => t.type === 'expense' && t.category_id === budget.category_id).reduce((sum, t) => sum + number(t.amount), 0); const percent = Math.min(100, used / Math.max(number(budget.amount), 1) * 100); return <article className={`budget-card ${percent >= 90 ? 'danger' : percent >= 75 ? 'warning' : ''}`} key={budget.id}><div className="budget-top"><div><span className="content-eyebrow">Monthly budget</span><h3>{budget.name}</h3></div><strong>{Math.round(percent)}%</strong></div><div className="progress-track"><span style={{ width: `${percent}%` }} /></div><div className="budget-bottom"><span>{money(used)} used</span><strong>{money(Math.max(0, number(budget.amount) - used))} left</strong></div>{percent >= 90 && <div className="budget-alert">!</div>}</article>; })}{!data.budgets.length && <div className="wide-empty"><EmptyState title="No budgets yet" body="Create a few soft limits for the categories that matter most." action="Set a budget" onAction={() => setModal('budget')} /></div>}</section></div>; }

function GoalsView({ data, setModal }: { data: FinanceData; setModal: (modal: Modal) => void }) { return <div className="view-stack"><section className="module-header"><div><span className="content-eyebrow">Future you will thank you</span><h2>Savings goals</h2><p>Make progress visible and the next deposit obvious.</p></div><button className="primary-button" onClick={() => setModal('goal')}>+ Create goal</button></section><section className="goal-grid">{data.goals.map((goal) => { const percent = Math.min(100, number(goal.current_amount) / Math.max(number(goal.target_amount), 1) * 100); return <article className="goal-card" key={goal.id}><div className="goal-card-head"><div className="goal-orbit">◎</div><span>{goal.target_date ? `${Math.ceil((new Date(goal.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))} days left` : 'No target date'}</span></div><h3>{goal.name}</h3><strong>{money(goal.current_amount)}</strong><span>of {money(goal.target_amount)}</span><div className="progress-track"><span style={{ width: `${percent}%` }} /></div><div className="goal-card-foot"><span>{Math.round(percent)}% complete</span><strong>{money(goal.suggested_monthly_saving)}/mo suggested</strong></div></article>; })}{!data.goals.length && <div className="wide-empty"><EmptyState title="Name your next milestone" body="A goal turns spare cash into a plan you can feel." action="Create goal" onAction={() => setModal('goal')} /></div>}</section></div>; }

function BillsView({ data, setModal, markBillPaid }: { data: FinanceData; setModal: (modal: Modal) => void; markBillPaid: (bill: RecurringPayment) => void }) { const total = data.recurring.filter((bill) => !bill.is_paid).reduce((sum, bill) => sum + number(bill.amount), 0); return <div className="view-stack"><section className="module-header"><div><span className="content-eyebrow">Never miss the quiet commitments</span><h2>Bills & subscriptions</h2><p>{money(total)} due across {data.recurring.length} recurring payments.</p></div><button className="primary-button" onClick={() => setModal('bill')}>+ Add payment</button></section><section className="finance-card"><div className="list-summary"><div><span>Coming up</span><strong>{data.recurring.filter((bill) => !bill.is_paid).length}</strong></div><div><span>Subscriptions</span><strong>{data.recurring.filter((bill) => bill.payment_type === 'subscription').length}</strong></div><div><span>Monthly commitment</span><strong>{money(total)}</strong></div></div><div className="recurring-table"><div className="transaction-head"><span>Payment</span><span>Type</span><span>Due date</span><span>Amount</span><span /></div>{data.recurring.map((bill) => <div className="transaction-row" key={bill.id}><div className="transaction-name"><span className="transaction-icon recurring">◷</span><span><strong>{bill.name}</strong><small>Every {bill.cadence}</small></span></div><span className="pill-soft">{bill.payment_type}</span><span className="transaction-date">{dateLabel(bill.next_due_date)}</span><strong className="transaction-amount expense">−{moneyExact(bill.amount)}</strong><button className={`paid-toggle ${bill.is_paid ? 'checked' : ''}`} onClick={() => markBillPaid(bill)}>{bill.is_paid ? 'Paid ✓' : 'Mark paid'}</button></div>)}{!data.recurring.length && <EmptyState title="No recurring payments" body="Track rent, subscriptions, EMIs, and reminders here." action="Add payment" onAction={() => setModal('bill')} />}</div></section></div>; }

function InvestmentsView({ data, setModal }: { data: FinanceData; setModal: (modal: Modal) => void }) { const invested = data.investments.reduce((sum, item) => sum + number(item.invested_amount), 0); const current = data.investments.reduce((sum, item) => sum + number(item.current_value), 0); return <div className="view-stack"><section className="module-header"><div><span className="content-eyebrow">Let your money compound</span><h2>Investments</h2><p>{data.investments.length} holdings · {money(current - invested)} unrealized gain.</p></div><button className="primary-button" onClick={() => setModal('investment')}>+ Add investment</button></section><section className="investment-summary"><div><span>Invested</span><strong>{money(invested)}</strong></div><div><span>Current value</span><strong>{money(current)}</strong></div><div><span>Profit / loss</span><strong className={current >= invested ? 'positive' : 'negative'}>{current >= invested ? '+' : '−'}{money(Math.abs(current - invested))}</strong></div></section><section className="finance-card"><div className="investment-table"><div className="transaction-head"><span>Holding</span><span>Type</span><span>As of</span><span>Current value</span><span /></div>{data.investments.map((investment) => <div className="transaction-row" key={investment.id}><div className="transaction-name"><span className="investment-icon">↗</span><span><strong>{investment.name}</strong><small>{investment.symbol || 'Long-term holding'}</small></span></div><span className="pill-soft">{investment.investment_type.replace('_', ' ')}</span><span className="transaction-date">{dateLabel(investment.as_of_date)}</span><strong className="transaction-amount">{moneyExact(investment.current_value)}</strong><span className={number(investment.current_value) >= number(investment.invested_amount) ? 'positive' : 'negative'}>{number(investment.current_value) >= number(investment.invested_amount) ? '+' : '−'}{money(Math.abs(number(investment.current_value) - number(investment.invested_amount)))}</span></div>)}{!data.investments.length && <EmptyState title="Your portfolio starts here" body="Track stocks, mutual funds, SIPs, gold, FDs, crypto, and more." action="Add investment" onAction={() => setModal('investment')} />}</div></section></div>; }

function AnalyticsView({ data, stats, categorySpend, importedData, setView }: { data: FinanceData; stats: { income: number; expenses: number; savings: number; savingsRate: number }; categorySpend: { name: string; color: string; total: number }[]; importedData: ImportData; setView: (view: View) => void }) {
  const top = Math.max(...categorySpend.map((item) => item.total), 1);
  const analysis = analyzeImportData(importedData);
  const importedMeta = [
    analysis.orderRows ? analysis.orderRows + ' orders' : '',
    analysis.productRows ? analysis.productRows + ' products' : '',
    analysis.paymentRows ? analysis.paymentRows + ' payment rows' : '',
    analysis.payoutRows ? analysis.payoutRows + ' payouts' : '',
    analysis.expenseRows ? analysis.expenseRows + ' expenses' : '',
  ].filter(Boolean).join(' · ') || 'Connect the Shopify export pack';
  const transactionTrend = useMemo(() => {
    const months = new Map<string, { income: number; expenses: number }>();
    data.transactions.forEach((transaction) => {
      const month = transaction.transaction_date.slice(0, 7);
      const current = months.get(month) || { income: 0, expenses: 0 };
      if (transaction.type === 'income') current.income += number(transaction.amount);
      if (transaction.type === 'expense') current.expenses += number(transaction.amount);
      months.set(month, current);
    });
    return [...months.entries()].sort(([first], [second]) => first.localeCompare(second)).slice(-6).map(([month, values]) => ({ month, ...values }));
  }, [data.transactions]);
  const trendMax = Math.max(...transactionTrend.flatMap((item) => [item.income, item.expenses]), 1);
  const monthShortLabel = (month: string) => new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(new Date(month + '-01T00:00:00'));
  return <div className="view-stack">
    <section className="module-header"><div><span className="content-eyebrow">Your patterns, not just your totals</span><h2>Analytics</h2><p>Understand the decisions behind the numbers.</p></div><div className="month-selector">{monthLabel(today)} ⌄</div></section>
    <section className="analytics-kpis"><KpiCard label="Savings rate" value={stats.savingsRate + '%'} meta="income kept" tone="green" symbol="◎" /><KpiCard label="Largest category" value={categorySpend[0]?.name || '—'} meta={categorySpend[0] ? money(categorySpend[0].total) : 'Add expenses'} tone="orange" symbol="◒" /><KpiCard label="Invested" value={money(data.investments.reduce((sum, item) => sum + number(item.current_value), 0))} meta="current portfolio value" tone="violet" symbol="↗" /><KpiCard label="Imported activity" value={analysis.totalRows.toLocaleString()} meta={importedMeta} tone="blue" symbol="⇵" /></section>
    <div className="analytics-grid"><section className="finance-card"><CardHeading eyebrow="Category view" title="Where your money went" /><div className="horizontal-bars">{categorySpend.map((item) => <div className="horizontal-row" key={item.name}><div><span>{item.name}</span><strong>{money(item.total)}</strong></div><div className="horizontal-track"><span style={{ width: item.total / top * 100 + '%', background: item.color }} /></div></div>)}{!categorySpend.length && <EmptyState title="Analytics need a little activity" body="Add a few transactions to see your patterns." />}</div></section><section className="finance-card"><CardHeading eyebrow="Monthly trend" title="Money in vs money out" /><div className="trend-lines" role="img" aria-label="Monthly income and expense trend">{transactionTrend.length ? transactionTrend.map((item) => <div className="trend-pair" key={item.month} aria-label={monthShortLabel(item.month) + ': ' + money(item.income) + ' income, ' + money(item.expenses) + ' expenses'}><div className="trend-line income-trend" style={{ height: Math.max(10, item.income / trendMax * 100) + '%' }} /><div className="trend-line expense-trend" style={{ height: Math.max(8, item.expenses / trendMax * 100) + '%' }} /></div>) : <div className="trend-empty">Add transactions to see a month-by-month cashflow trend.</div>}</div><div className="trend-labels">{transactionTrend.length ? transactionTrend.map((item) => <span key={item.month}>{monthShortLabel(item.month)}</span>) : <span>Waiting for activity</span>}</div><div className="chart-meta"><span><i className="legend-income" /> Income {money(stats.income)}</span><span><i className="legend-expense" /> Expenses {money(stats.expenses)}</span></div></section></div>
    {importedData.batches.length > 0 && <>
      <ShopifyPnlSummary analysis={analysis} compact />
      <section className="finance-card analytics-import-card"><CardHeading eyebrow="Source-aware analytics" title="Imported Shopify activity" action="Review imports" onAction={() => setView('imports')} /><div className="analytics-import-grid"><div><span>Net sales</span><strong>{moneyExact(analysis.netSales, analysis.currency)}</strong><small>{analysis.orderRows} order rows</small></div><div><span>Estimated profit</span><strong className={analysis.estimatedOperatingProfit >= 0 ? 'positive' : 'negative'}>{moneyExact(analysis.estimatedOperatingProfit, analysis.currency)}</strong><small>{analysis.pnlReady ? 'Five-file P&L pack connected' : 'P&L pack incomplete'}</small></div><div><span>Settlement gap</span><strong className={Math.abs(analysis.reconciliationDifference) < 0.01 ? 'positive' : 'negative'}>{moneyExact(analysis.reconciliationDifference, analysis.currency)}</strong><small>{analysis.balancedPayouts}/{analysis.reconciledPayouts} balanced payouts</small></div></div><div className="import-event-pills">{analysis.eventBreakdown.slice(0, 5).map((item) => <span key={item.label}><b>{item.count}</b> {item.label}</span>)}</div></section>
    </>}
  </div>;
}

function LendingView({ data, setModal }: { data: FinanceData; setModal: (modal: Modal) => void }) { const outstanding = data.loans.reduce((sum, item) => sum + number(item.outstanding), 0) + data.splits.filter((item) => !item.is_settled).reduce((sum, item) => sum + number(item.amount), 0); return <div className="view-stack"><section className="module-header"><div><span className="content-eyebrow">Keep the relationship, remember the number</span><h2>Lending & splits</h2><p>{money(outstanding)} still in motion across friends, family, and shared expenses.</p></div><button className="primary-button" onClick={() => setModal('loan')}>+ Add lending entry</button></section><div className="lending-grid"><section className="finance-card"><CardHeading eyebrow="Loans" title="Lent & borrowed" action="Add loan" onAction={() => setModal('loan')} /><div className="loan-list">{data.loans.map((loan) => <div className="loan-row" key={loan.id}><span className={'loan-icon ' + loan.direction}>{loan.direction === 'lent' ? '↗' : '↙'}</span><div><strong>{loan.counterparty_name}</strong><small>{loan.direction === 'lent' ? 'Owes you' : 'You owe'} · {loan.status}</small></div><strong>{money(loan.outstanding)}</strong></div>)}{!data.loans.length && <EmptyState title="No loans tracked" body="Keep personal lending clear and kind." action="Add loan" onAction={() => setModal('loan')} />}</div></section><section className="finance-card"><CardHeading eyebrow="Shared expenses" title="Who owes what" action="Add split" onAction={() => setModal('split')} /><div className="loan-list">{data.splits.map((split) => <div className="loan-row" key={split.id}><span className="loan-icon split">⇄</span><div><strong>{split.participant_name}</strong><small>{split.is_settled ? 'Settled' : split.direction === 'owed_to_me' ? 'Owes you' : 'You owe'}</small></div><strong className={split.is_settled ? 'muted' : ''}>{money(split.amount)}</strong></div>)}{!data.splits.length && <EmptyState title="No split expenses" body="Split a meal, trip, or household cost when you need to." action="Add split" onAction={() => setModal('split')} />}</div></section></div></div>; }

function ReportsView({ data, importedData, exportCsv, setView }: { data: FinanceData; importedData: ImportData; exportCsv: () => void; setView: (view: View) => void }) {
  const analysis = analyzeImportData(importedData);
  return <div className="view-stack">
    <section className="module-header"><div><span className="content-eyebrow">A clear record when you need it</span><h2>Reports</h2><p>Export your financial history for review, tax time, or a planning conversation.</p></div><div className="content-actions"><button className="secondary-button" onClick={() => setView('imports')}>Review Shopify imports</button><button className="secondary-button" onClick={() => window.print()}>Export PDF</button><button className="primary-button" onClick={exportCsv}>Download CSV</button></div></section>
    <section className="report-card"><div className="report-hero"><div className="report-mark">▦</div><div><span className="content-eyebrow">{monthLabel(today)} snapshot</span><h3>Monthly money report</h3><p>Income, expenses, savings, and transaction history in a portable format.</p></div></div><div className="report-stat-row"><div><span>Total income</span><strong>{money(data.transactions.filter((t) => t.type === 'income').reduce((sum, t) => sum + number(t.amount), 0))}</strong></div><div><span>Total expenses</span><strong>{money(data.transactions.filter((t) => t.type === 'expense').reduce((sum, t) => sum + number(t.amount), 0))}</strong></div><div><span>Records</span><strong>{data.transactions.length}</strong></div></div></section>
    {importedData.batches.length > 0 && <>
      <ShopifyPnlSummary analysis={analysis} />
      <section className="finance-card imported-report-card"><CardHeading eyebrow="Shopify source reconciliation" title="Revenue, costs, and settlement trail" /><div className="report-stat-row"><div><span>Order rows</span><strong>{analysis.orderRows}</strong></div><div><span>Product costs</span><strong>{analysis.productRows}</strong></div><div><span>Payment rows</span><strong>{analysis.paymentRows}</strong></div><div><span>Operating expenses</span><strong>{analysis.expenseRows}</strong></div><div><span>Gross sales</span><strong>{moneyExact(analysis.grossSales, analysis.currency)}</strong></div><div><span>Net sales</span><strong>{moneyExact(analysis.netSales, analysis.currency)}</strong></div><div><span>Fees</span><strong>{moneyExact(analysis.paymentFees, analysis.currency)}</strong></div><div><span>Payout total</span><strong>{moneyExact(analysis.payoutTotal, analysis.currency)}</strong></div><div><span>Balanced payouts</span><strong>{analysis.balancedPayouts}/{analysis.reconciledPayouts}</strong></div><div><span>Settlement gap</span><strong className={Math.abs(analysis.reconciliationDifference) < 0.01 ? 'positive' : 'negative'}>{moneyExact(analysis.reconciliationDifference, analysis.currency)}</strong></div></div><p className="muted-copy">The Shopify P&L is an accrual estimate. Payout activity is preserved separately so bank cash timing can be reconciled without treating settlement as revenue.</p></section>
    </>}
  </div>;
}

function ImportCenterView({ importedData, onImportFiles, onShopifyImport, onDeleteBatch, loading, error, message, shopifySyncLoading, shopifySyncError, shopifySyncMessage }: { importedData: ImportData; onImportFiles: (files: File[]) => Promise<boolean>; onShopifyImport: (period: ShopifyImportPeriod, storeDomain?: string) => Promise<boolean>; onDeleteBatch: (batch: FinanceImportBatch) => void; loading: boolean; error: string; message: string; shopifySyncLoading: boolean; shopifySyncError: string; shopifySyncMessage: string }) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [selectionError, setSelectionError] = useState('');
  const [shopifyImportOpen, setShopifyImportOpen] = useState(false);
  const [shopifyPeriod, setShopifyPeriod] = useState<ShopifyImportPeriod>('last_month');
  const [shopifyStoreDomain, setShopifyStoreDomain] = useState(() => {
    try { return window.sessionStorage.getItem('gcs-books-shopify-store-domain') || ''; } catch { return ''; }
  });
  const configuredShopifyMode = String(import.meta.env.VITE_SHOPIFY_CONNECTION_MODE || '').trim().toLowerCase();
  const shopifyMode = import.meta.env.DEV ? 'cli' : configuredShopifyMode === 'client_credentials' ? 'client_credentials' : 'oauth';
  const shopifyConnectionTitle = shopifyMode === 'cli'
    ? 'Shopify CLI sync'
    : shopifyMode === 'client_credentials'
      ? 'Shopify native server connection'
      : 'Shopify secure connection';
  const shopifyConnectionSubcopy = shopifyMode === 'cli'
    ? 'Authorizes on first use for this GCS Books user · no token is stored in the browser'
    : shopifyMode === 'client_credentials'
      ? 'Runs on Vercel without browser approval · credentials and tokens stay server-side'
      : 'Connects this GCS Books user on first use · the token is encrypted server-side';
  const shopifyConnectionHelp = shopifyMode === 'cli'
    ? 'Orders, product costs, payments, and payouts are synced for the selected period. On first use for this GCS Books user, Shopify CLI authorization opens automatically and the import continues after approval. Shopify cannot expose every merchant cost, so add apps, ads, fulfilment, payroll, and other operating expenses with the template to complete the holistic P&L.'
    : shopifyMode === 'client_credentials'
      ? 'Orders, product costs, payments, and payouts are synced for the selected period. The Vercel server creates or refreshes the Shopify connection automatically, with no CLI session or browser approval. Shopify cannot expose every merchant cost, so add apps, ads, fulfilment, payroll, and other operating expenses with the template to complete the holistic P&L.'
      : 'Orders, product costs, payments, and payouts are synced for the selected period. The first import opens Shopify approval for this GCS Books user, then returns here and continues automatically. Shopify cannot expose every merchant cost, so add apps, ads, fulfilment, payroll, and other operating expenses with the template to complete the holistic P&L.';
  const analysis = analyzeImportData(importedData);
  const currency = analysis.currency || 'USD';
  const loadedKinds = new Set<ImportSourceKind>(importedData.batches.filter((batch) => batch.status === 'completed').map((batch) => batch.source_kind === 'payment_transactions' ? 'shopify_payment_transactions' : batch.source_kind));
  const connectedRequirements = SHOPIFY_EXPORT_REQUIREMENTS.filter((requirement) => loadedKinds.has(requirement.kind)).length;
  const chooseFiles = (fileList: FileList | null) => acceptFiles(Array.from(fileList ?? []));
  const acceptFiles = (files: File[]) => {
    const oversized = files.filter((file) => file.size > MAX_IMPORT_FILE_SIZE);
    const supported = files.filter((file) => /\.(csv|pdf)$/i.test(file.name) && file.size <= MAX_IMPORT_FILE_SIZE);
    const rejected = files.filter((file) => !/\.(csv|pdf)$/i.test(file.name));
    setSelectedFiles((current) => {
      const merged = [...current, ...supported];
      const seen = new Set<string>();
      return merged.filter((file) => {
        const key = importFileKey(file);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
    const messages: string[] = [];
    if (rejected.length) messages.push(rejected.map((file) => file.name).join(', ') + (rejected.length === 1 ? ' is' : ' are') + ' not supported. Choose Shopify CSV or payout PDF exports.');
    if (oversized.length) messages.push(oversized.map((file) => file.name).join(', ') + (oversized.length === 1 ? ' is' : ' are') + ' larger than 25 MB and was skipped.');
    setSelectionError(messages.join(' '));
  };
  const removeFile = (file: File) => setSelectedFiles((current) => current.filter((item) => importFileKey(item) !== importFileKey(file)));
  const importFiles = async () => { if (selectedFiles.length && !loading) { const imported = await onImportFiles(selectedFiles); if (imported) setSelectedFiles([]); } };
  const paymentRows = importedData.payments.slice(0, 25);
  const payoutRows = importedData.payouts.slice(0, 20);
  const reviewCount = importedData.batches.reduce((sum, batch) => sum + (batch.review_count || 0), 0);
  const requirementStatus = analysis.pnlReady ? 'Complete' : connectedRequirements + '/5 connected';
  const syncShopify = async () => {
    const storeDomain = shopifyStoreDomain.trim();
    try { if (storeDomain) window.sessionStorage.setItem('gcs-books-shopify-store-domain', storeDomain); } catch { /* session storage may be unavailable */ }
    const imported = await onShopifyImport(shopifyPeriod, storeDomain || undefined);
    if (imported) setShopifyImportOpen(false);
  };
  return <div className="view-stack import-view">
    <section className="module-header"><div><span className="content-eyebrow">Shopify data, connected end to end</span><h2>Shopify import center</h2><p>Sync live Shopify records for a reporting period or upload the complete export pack for a holistic profit and loss.</p></div><div className="import-header-actions"><button type="button" className="primary-button shopify-sync-button" onClick={() => setShopifyImportOpen(true)} disabled={shopifySyncLoading}><span className="shopify-button-mark">S</span>{shopifySyncLoading ? 'Syncing Shopify…' : 'Import from Shopify ↗'}</button><div className="import-source-badge"><span>5 FILE PACK</span><small>{requirementStatus}</small></div></div></section>
    {shopifySyncError && <div className="shopify-sync-feedback error" role="alert"><span>!</span><div><strong>Shopify sync needs attention</strong><p>{shopifySyncError}</p></div></div>}
    {shopifySyncMessage && <div className="shopify-sync-feedback success" role="status"><span>✓</span><div><strong>Shopify sync complete</strong><p>{shopifySyncMessage}</p></div></div>}
    <section className="finance-card shopify-requirements"><CardHeading eyebrow="Required for a trustworthy P&L" title="Connect the five Shopify exports" /><p className="requirements-intro">Orders explain revenue, products explain cost of goods, payments explain fees, payouts explain cash timing, and operating expenses complete the picture.</p><div className="shopify-requirement-list">{SHOPIFY_EXPORT_REQUIREMENTS.map((requirement, index) => {
      const complete = loadedKinds.has(requirement.kind);
      return <div className={'shopify-requirement ' + (complete ? 'is-complete' : '')} key={requirement.kind}><span className="requirement-index">{complete ? '✓' : String(index + 1).padStart(2, '0')}</span><div className="requirement-copy"><strong>{requirement.label}</strong><p>{requirement.description}</p><small className="requirement-path">{requirement.exportPath}</small></div><span className="requirement-state">{complete ? 'Connected' : 'Required'}</span></div>;
    })}</div><div className="requirement-footer"><button type="button" className="secondary-button import-template-action" onClick={downloadOperatingExpenseTemplate}>Download expense template</button><span>Export each Shopify file for the same reporting period, then add them together below.</span></div></section>
    <section className="import-layout"><div className="finance-card import-uploader"><div className={'import-dropzone ' + (isDragging ? 'is-dragging' : '')} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDragging(false); }} onDrop={(event) => { event.preventDefault(); setIsDragging(false); acceptFiles(Array.from(event.dataTransfer.files)); }}><input aria-label="Choose Shopify CSV or PDF files" type="file" accept=".csv,.pdf,text/csv,application/pdf" multiple onChange={(event) => { chooseFiles(event.target.files); event.currentTarget.value = ''; }} /><span className="import-upload-icon">⇧</span><strong>{isDragging ? 'Release to add your Shopify exports' : 'Drop Shopify exports here or choose files'}</strong><small>Orders, products, payments, operating expenses, and text-based payout PDFs are supported.</small><em>Files stay in your workspace and imported records are user-scoped.</em><span className="import-browse-hint">Browse files · up to 25 MB each</span></div>{selectedFiles.length > 0 && <div className="import-file-list"><div className="import-section-label">Ready to analyse</div>{selectedFiles.map((file) => <div className="import-file-row" key={importFileKey(file)}><span className="file-type-pill">{file.name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'CSV'}</span><div><strong>{file.name}</strong><small>{Math.max(1, Math.round(file.size / 1024))} KB</small></div><button type="button" aria-label={'Remove ' + file.name} onClick={() => removeFile(file)}>×</button></div>)}<button type="button" className="primary-button import-action" disabled={loading} onClick={importFiles}>{loading ? 'Reading Shopify exports…' : 'Analyse & import ' + selectedFiles.length + ' file' + (selectedFiles.length === 1 ? '' : 's') + ' ↗'}</button></div>}{selectionError && <div className="import-feedback error" role="alert"><span>!</span>{selectionError}</div>}{error && <div className="import-feedback error" role="alert"><span>!</span>{error}</div>}{message && <div className="import-feedback success" role="status"><span>✓</span>{message}</div>}</div><section className="finance-card import-how-card"><CardHeading eyebrow="Connected everywhere" title="One Shopify pack, many views" /><div className="import-connection-list"><div><span>01</span><p><strong>Holistic P&L</strong><small>Revenue, COGS, processor fees, and operating expenses are calculated together.</small></p></div><div><span>02</span><p><strong>Transaction ledger</strong><small>Payment activity is categorised into imported income, refunds, adjustments, and fees.</small></p></div><div><span>03</span><p><strong>Reports & analytics</strong><small>Source rows, trends, P&L status, and settlement gaps stay visible for review.</small></p></div><div><span>04</span><p><strong>Calendar & cash timing</strong><small>Payout dates stay connected without confusing settlement with earned revenue.</small></p></div></div></section></section>
    {importedData.batches.length > 0 && <>
      <ShopifyPnlSummary analysis={analysis} />
      <section className="import-kpi-grid"><KpiCard label="Imported source rows" value={String(analysis.totalRows)} meta={analysis.orderRows + ' orders · ' + analysis.productRows + ' products · ' + analysis.expenseRows + ' expenses'} tone="green" symbol="⇵" /><KpiCard label="Net sales" value={moneyExact(analysis.netSales, currency)} meta={analysis.grossSales ? 'Gross ' + moneyExact(analysis.grossSales, currency) : 'Waiting for Orders export'} tone="blue" symbol="↙" /><KpiCard label="Costs & fees" value={moneyExact(analysis.cogs + analysis.paymentFees + analysis.operatingExpenses, currency)} meta={moneyExact(analysis.cogs, currency) + ' COGS · ' + moneyExact(analysis.paymentFees, currency) + ' fees · ' + moneyExact(analysis.operatingExpenses, currency) + ' expenses'} tone="orange" symbol="−" /><KpiCard label="Payout total" value={moneyExact(analysis.payoutTotal, currency)} meta={'Net movement ' + moneyExact(analysis.netTransactionMovement, currency) + ' · Gap ' + moneyExact(analysis.reconciliationDifference, currency)} tone="violet" symbol="↗" /></section>
      <section className="finance-card shopify-source-card"><CardHeading eyebrow="Source coverage" title="What is connected" /><div className="shopify-source-grid"><div><span>Orders</span><strong>{analysis.orderRows}</strong><small>{moneyExact(analysis.netSales, currency)} net sales</small></div><div><span>Products + cost</span><strong>{analysis.productRows}</strong><small>{analysis.cogsMatchedUnits.toLocaleString()} units matched</small></div><div><span>Payments</span><strong>{analysis.paymentRows}</strong><small>{moneyExact(analysis.paymentFees, currency)} fees identified</small></div><div><span>Payouts</span><strong>{analysis.payoutRows}</strong><small>{analysis.balancedPayouts}/{analysis.reconciledPayouts} balanced</small></div><div><span>Operating expenses</span><strong>{analysis.expenseRows}</strong><small>{moneyExact(analysis.operatingExpenses, currency)} captured</small></div></div></section>
      <section className="import-analysis-grid"><div className="finance-card"><CardHeading eyebrow="Payment event mix" title="What the payment export contains" />{analysis.eventBreakdown.length ? analysis.eventBreakdown.map((item) => <div className="import-breakdown-row" key={item.label}><div><strong>{item.label}</strong><small>{item.count} records</small></div><strong>{moneyExact(item.amount, currency)}</strong></div>) : <p className="muted-copy">Payment event mix appears after the Payments transactions export is connected.</p>}</div><div className="finance-card"><CardHeading eyebrow="Settlement health" title="Status and monthly trend" />{analysis.statusBreakdown.map((item) => <div className="import-breakdown-row" key={item.label}><div><strong>{item.label}</strong><small>{item.count} records</small></div><strong>{moneyExact(item.amount, currency)}</strong></div>)}<div className="import-mini-trend">{analysis.monthlyTrend.map((item) => <div key={item.month}><span>{item.month}</span><i style={{ height: Math.max(8, Math.min(100, item.gross / Math.max(analysis.grossVolume, 1) * 100 * 4)) + '%' }} /><small>{moneyExact(item.net, currency)}</small></div>)}</div>{!analysis.monthlyTrend.length && <p className="muted-copy">Monthly payment trend appears after the Payments transactions export is connected.</p>}</div></section>
      <section className="finance-card"><div className="import-table-heading"><div><span className="content-eyebrow">Detailed rows</span><h3>Payment transactions</h3><p>Showing the first {Math.min(paymentRows.length, 25)} of {analysis.paymentRows} rows. Full records remain available in the database.</p></div><div className="import-table-meta">{analysis.dateFrom ? dateLabel(analysis.dateFrom) + ' – ' + dateLabel(analysis.dateTo) : 'No date range'}</div></div><div className="import-table"><div className="import-table-head"><span>Transaction date</span><span>Event / order</span><span>Status</span><span>Gross</span><span>Fee</span><span>Net</span></div>{paymentRows.map((row) => <div className="import-table-row" key={row.source_key}><span>{dateLabel(row.transaction_date)}</span><span><strong>{row.event_type}</strong><small>{row.order_id || row.payment_method_name || 'Unlabelled payment'}{row.payout_id ? ' · payout ' + row.payout_id : ''}{row.payout_date ? ' · settles ' + dateLabel(row.payout_date) : ''}</small></span><span className={'import-status ' + (row.payout_status || 'unknown')}>{row.payout_status || '—'}</span><strong>{moneyExact(row.amount, row.currency)}</strong><span>{moneyExact(row.fee, row.currency)}</span><strong className={number(row.net) < 0 ? 'negative' : 'positive'}>{moneyExact(row.net, row.currency)}</strong></div>)}{!paymentRows.length && <EmptyState title="No payment transactions yet" body="Import the Payments transactions CSV to see detailed rows here." />}</div></section>
      <section className="finance-card"><div className="import-table-heading"><div><span className="content-eyebrow">Settlement detail</span><h3>Payout activity</h3><p>Bank references and settlement components are preserved for reconciliation.</p></div><div className="import-table-meta">{analysis.payoutRows} payouts</div></div><div className="import-table payout-table"><div className="import-table-head"><span>Date</span><span>Status / bank reference</span><span>Charges</span><span>Refunds</span><span>Fees</span><span>Total</span></div>{payoutRows.map((row) => <div className="import-table-row" key={row.source_key}><span>{dateLabel(row.payout_date)}</span><span><strong>{row.status}</strong><small>{row.bank_reference}</small></span><span>{moneyExact(row.charges, row.currency)}</span><span>{moneyExact(row.refunds, row.currency)}</span><span>{moneyExact(row.fees, row.currency)}</span><strong>{moneyExact(row.total, row.currency)}</strong></div>)}{!payoutRows.length && <EmptyState title="No payout activity yet" body="Import the Payout activity export or text-based PDF to see settlement rows here." />}</div></section>
    </>}
    {importedData.batches.length > 0 && <section className="finance-card"><CardHeading eyebrow="Import history" title="Shopify source files" />{importedData.batches.map((batch) => <div className="import-history-row" key={batch.id}><span className="file-type-pill">{batch.file_type.toUpperCase()}</span><div><strong>{batch.file_name}</strong><small>{sourceKindLabel(batch.source_kind)} · {dateLabel(batch.imported_at.slice(0, 10))}</small></div><span className="import-history-status">{batch.imported_count} imported{batch.duplicate_count ? ' · ' + batch.duplicate_count + ' skipped' : ''}{batch.review_count ? ' · ' + batch.review_count + ' review' : ''}</span><button className="import-history-delete" type="button" aria-label={'Delete imported file ' + batch.file_name} onClick={() => onDeleteBatch(batch)}>Delete</button></div>)}</section>}
    {shopifyImportOpen && <div className="modal-backdrop" onClick={() => { if (!shopifySyncLoading) setShopifyImportOpen(false); }}><div className="finance-modal shopify-sync-modal" role="dialog" aria-modal="true" aria-labelledby="shopify-sync-title" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="content-eyebrow">Live Shopify connection</span><h2 id="shopify-sync-title">Import from Shopify</h2><p>Choose a reporting period and we’ll pull the source data into the same P&L, ledger, reports, analytics, and calendar views.</p></div><button type="button" aria-label="Close Shopify import" disabled={shopifySyncLoading} onClick={() => setShopifyImportOpen(false)}>×</button></div><div className="shopify-sync-badge"><span className="shopify-button-mark">S</span><div><strong>{shopifyConnectionTitle}</strong><small>{shopifyConnectionSubcopy}</small></div><span className="shopify-sync-live-dot" /></div>{shopifyMode !== 'cli' && <label className="modal-field shopify-store-field"><span>Shopify store</span><input aria-label="Shopify store domain" value={shopifyStoreDomain} onChange={(event) => setShopifyStoreDomain(event.target.value)} placeholder="your-store.myshopify.com" autoComplete="organization" disabled={shopifySyncLoading} /><small>Choose a store at runtime. Leave blank only if this GCS Books user already has a saved Shopify connection.</small></label>}<label className="modal-field shopify-sync-select"><span>Time period</span><select aria-label="Shopify import time period" value={shopifyPeriod} onChange={(event) => setShopifyPeriod(event.target.value as ShopifyImportPeriod)} disabled={shopifySyncLoading}>{SHOPIFY_IMPORT_PERIODS.map((period) => <option value={period.value} key={period.value}>{period.label} · {period.description}</option>)}</select></label><div className="shopify-sync-help"><span>i</span><p>{shopifyConnectionHelp}</p></div>{shopifySyncError && <div className="shopify-sync-inline-error" role="alert"><span>!</span>{shopifySyncError}</div>}<div className="modal-actions"><button className="secondary-button" type="button" disabled={shopifySyncLoading} onClick={() => setShopifyImportOpen(false)}>Cancel</button><button className="primary-button shopify-sync-submit" type="button" disabled={shopifySyncLoading} onClick={syncShopify}>{shopifySyncLoading ? 'Syncing Shopify…' : 'Start Shopify import ↗'}</button></div></div></div>}
  </div>;
}

function CalendarView({ data, importedData }: { data: FinanceData; importedData: ImportData }) {
  const [monthCursor, setMonthCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const events = [...data.recurring.map((item) => ({ id: `bill-${item.id}`, title: item.name, date: item.next_due_date, amount: item.amount, type: item.payment_type, imported: false })), ...data.goals.filter((item) => item.target_date).map((item) => ({ id: `goal-${item.id}`, title: `${item.name} target date`, date: item.target_date as string, amount: item.target_amount, type: 'goal', imported: false })), ...importedData.payouts.map((item) => ({ id: `payout-${item.source_key}`, title: 'Imported payout settlement', date: item.payout_date, amount: item.total, type: 'imported payout', imported: true }))].sort((a, b) => a.date.localeCompare(b.date));
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingEmptyDays = (new Date(year, month, 1).getDay() + 6) % 7;
  const dateKey = (day: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthEvents = events.filter((event) => event.date.startsWith(monthPrefix));
  const eventDates = new Set(monthEvents.map((event) => event.date));
  const upcomingEvents = monthEvents.filter((event) => event.date >= isoToday()).slice(0, 9);
  const visibleEvents = upcomingEvents.length ? upcomingEvents : monthEvents.slice().reverse().slice(0, 9);
  const eventsEyebrow = upcomingEvents.length ? 'Upcoming' : monthEvents.length ? 'This month' : 'No scheduled dates';
  return <div className="view-stack"><section className="module-header"><div><span className="content-eyebrow">Dates that deserve less mental space</span><h2>Financial calendar</h2><p>Bills, goals, and imported settlements, in one calm sequence.</p></div><div className="month-selector">{monthLabel(monthCursor)}</div></section><section className="calendar-layout"><div className="calendar-month"><div className="calendar-head"><button type="button" aria-label="Previous month" onClick={() => setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>‹</button><strong>{monthLabel(monthCursor)}</strong><button type="button" aria-label="Next month" onClick={() => setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>›</button></div><div className="calendar-week">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div><div className="calendar-days" aria-label={`${monthLabel(monthCursor)} financial activity`}>{Array.from({ length: leadingEmptyDays }, (_, index) => <span className="calendar-empty" aria-hidden="true" key={`empty-${index}`} />)}{Array.from({ length: daysInMonth }, (_, index) => { const day = index + 1; const key = dateKey(day); const currentDay = key === isoToday(); const hasImportedEvent = monthEvents.some((event) => event.date === key && event.imported); return <span className={`${currentDay ? 'today' : ''} ${eventDates.has(key) ? 'has-event' : ''} ${hasImportedEvent ? 'imported-event' : ''}`} title={eventDates.has(key) ? 'Financial activity' : undefined} key={key}>{day}</span>; })}</div><div className="calendar-legend"><span><i className="legend-income" /> Planned</span><span><i className="legend-import" /> Imported settlement</span></div></div><div className="calendar-events"><CardHeading eyebrow={eventsEyebrow} title="What’s next" />{visibleEvents.map((event) => <div className={`calendar-event ${event.imported ? 'imported' : ''}`} key={event.id}><span className="event-date">{new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(new Date(`${event.date}T00:00:00`))}</span><div><strong>{event.title}</strong><small>{event.type} · {money(event.amount)}</small></div><span>{event.imported ? '⇵' : '↗'}</span></div>)}{!visibleEvents.length && <EmptyState title={`No dates in ${monthLabel(monthCursor)}`} body="Add recurring payments, savings goals, or import a payout PDF to see financial activity here." />}</div></section></div>;
}

function NotificationPanel({ notifications, onClose, onMarkAllRead }: { notifications: FinanceNotification[]; onClose: () => void; onMarkAllRead: () => void }) { const unreadCount = notifications.filter((notification) => !notification.is_read).length; return <div className="notification-panel" role="dialog" aria-modal="true" aria-labelledby="notifications-title"><div className="notification-head"><strong id="notifications-title">Notifications</strong><div><button type="button" className="notification-read-all" onClick={onMarkAllRead} disabled={!unreadCount}>{unreadCount ? `Mark ${unreadCount} read` : 'All read'}</button><button type="button" aria-label="Close notifications" onClick={onClose}>×</button></div></div>{notifications.map((notification) => <div className={`notification-item ${notification.is_read ? 'read' : ''}`} key={notification.id}><span className={`notification-icon ${notification.kind}`}>{notification.kind === 'warning' ? '!' : notification.kind === 'reminder' ? '◷' : '✓'}</span><div><strong>{notification.title}</strong><p>{notification.body}</p></div></div>)}{!notifications.length && <div className="notification-empty">You’re all caught up.</div>}</div>; }

function AssistantPanel({ question, setQuestion, answer, onAsk, onClose }: { question: string; setQuestion: (value: string) => void; answer: string; onAsk: () => void; onClose: () => void }) { return <aside className="assistant-panel" role="dialog" aria-modal="true" aria-labelledby="assistant-title"><div className="assistant-head"><div><span className="assistant-spark">✦</span><div><strong id="assistant-title">Finance assistant</strong><small>Private to your workspace</small></div></div><button type="button" aria-label="Close finance assistant" onClick={onClose}>×</button></div><div className="assistant-intro"><p>Ask a plain-language question. I’ll use the numbers in your workspace to help you find the next useful move.</p><div className="suggestion-row"><button type="button" onClick={() => setQuestion('Where did I spend the most?')}>Top spend</button><button type="button" onClick={() => setQuestion('How long will it take to reach my goal?')}>Goal runway</button></div></div><div className="assistant-answer" aria-live="polite"><span>✦</span><p>{answer}</p></div><div className="assistant-input"><input aria-label="Ask the finance assistant" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onAsk(); }} placeholder="Ask about your money…" /><button type="button" aria-label="Send assistant question" onClick={onAsk}>↗</button></div></aside>; }

function TransactionModal({ form, setForm, accounts, categories, onSubmit, onClose }: { form: TransactionForm; setForm: (form: TransactionForm) => void; accounts: FinanceAccount[]; categories: FinanceCategory[]; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const categoryOptions = categoriesForTransaction(categories, form.type);
  const accountOptions = form.type === 'transfer' ? accounts.filter((account) => account.id !== form.accountId) : accounts;
  return <div className="modal-backdrop" onClick={onClose}><div className="finance-modal wide" role="dialog" aria-modal="true" aria-labelledby="transaction-modal-title" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="content-eyebrow">New record</span><h2 id="transaction-modal-title">Add transaction</h2><p>Every small detail makes your future reports more useful.</p></div><button type="button" aria-label="Close transaction form" onClick={onClose}>×</button></div><form className="modal-form" onSubmit={onSubmit}><div className="type-toggle" role="tablist" aria-label="Transaction type">{(['expense', 'income', 'transfer'] as const).map((type) => <button type="button" role="tab" aria-selected={form.type === type} className={form.type === type ? 'selected' : ''} key={type} onClick={() => setForm({ ...form, type, categoryId: type === 'transfer' ? '' : form.categoryId, transferAccountId: type === 'transfer' ? form.transferAccountId : '' })}>{type[0].toUpperCase() + type.slice(1)}</button>)}</div><div className="form-grid"><Field label="Amount" name="amount" type="number" value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} placeholder="0.00" min="0.01" step="0.01" required /><Field label="Date" name="date" type="date" value={form.transactionDate} onChange={(value) => setForm({ ...form, transactionDate: value })} required /></div><div className="form-grid"><SelectField label="Account" name="account" value={form.accountId} onChange={(value) => setForm({ ...form, accountId: value })} options={accounts.map((account) => account.id)} labels={accounts.map((account) => account.name)} required /><SelectField label={form.type === 'transfer' ? 'To account' : 'Category'} name="category" value={form.type === 'transfer' ? form.transferAccountId : form.categoryId} onChange={(value) => setForm(form.type === 'transfer' ? { ...form, transferAccountId: value } : { ...form, categoryId: value })} options={(form.type === 'transfer' ? accountOptions : categoryOptions).map((item) => item.id)} labels={(form.type === 'transfer' ? accountOptions : categoryOptions).map((item) => item.name)} required={form.type !== 'transfer'} /></div><div className="form-grid"><Field label="Merchant" name="merchant" value={form.merchant} onChange={(value) => setForm({ ...form, merchant: value })} placeholder="e.g. Swiggy" /><Field label="Tags" name="tags" value={form.tags} onChange={(value) => setForm({ ...form, tags: value })} placeholder="work, travel" /></div><Field label="Description" name="description" value={form.description} onChange={(value) => setForm({ ...form, description: value })} placeholder="Optional note for future you" /><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Save transaction ↗</button></div></form></div></div>;
}

function SimpleModal({ title, description, onSubmit, onClose, submitLabel, children }: { title: string; description: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void; submitLabel: string; children: ReactNode }) { return <div className="modal-backdrop" onClick={onClose}><div className="finance-modal" role="dialog" aria-modal="true" aria-labelledby="simple-modal-title" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="content-eyebrow">New plan</span><h2 id="simple-modal-title">{title}</h2><p>{description}</p></div><button type="button" aria-label={`Close ${title} form`} onClick={onClose}>×</button></div><form className="modal-form" onSubmit={onSubmit}>{children}<div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">{submitLabel} ↗</button></div></form></div></div>; }
function Field({ label, name, type = 'text', placeholder, required, value, onChange, min, step }: { label: string; name: string; type?: string; placeholder?: string; required?: boolean; value?: string; onChange?: (value: string) => void; min?: string; step?: string }) { return <label className="modal-field"><span>{label}</span><input name={name} type={type} placeholder={placeholder} required={required} min={min} step={step} value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined} /></label>; }
function SelectField({ label, name, options, labels, value, onChange, required }: { label: string; name: string; options: string[]; labels?: string[]; value?: string; onChange?: (value: string) => void; required?: boolean }) { return <label className="modal-field"><span>{label}</span><select name={name} required={required} value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined}><option value="">Choose {label.toLowerCase()}</option>{options.map((option, index) => <option key={option} value={option}>{labels?.[index] || option.replace('_', ' ')}</option>)}</select></label>; }
function ConfirmDialog({ title, body, onCancel, onConfirm, confirmLabel = 'Delete', disabled = false }: { title: string; body: string; onCancel: () => void; onConfirm: () => void; confirmLabel?: string; disabled?: boolean }) { return <div className="modal-backdrop" role="presentation"><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title"><div className="confirm-icon">!</div><h2 id="confirm-dialog-title">{title}</h2><p>{body}</p><div className="modal-actions"><button className="secondary-button" type="button" disabled={disabled} onClick={onCancel}>Keep it</button><button className="danger-button" type="button" disabled={disabled} onClick={onConfirm}>{confirmLabel}</button></div></div></div>; }
