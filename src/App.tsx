import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import {
  asMoneyString,
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
  emptyImportData,
  loadImportData,
  parseImportFile,
  persistParsedImport,
  type FinanceImportBatch,
  type ImportData,
} from './lib/imports';

type View = 'overview' | 'transactions' | 'accounts' | 'budgets' | 'goals' | 'bills' | 'investments' | 'analytics' | 'lending' | 'reports' | 'calendar' | 'imports';
type AuthMode = 'login' | 'signup' | 'reset';
type Modal = 'transaction' | 'account' | 'budget' | 'goal' | 'bill' | 'investment' | 'loan' | 'split' | null;

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
  { id: 'imports', label: 'Import center', icon: '⇵', group: 'Understand' },
];

const emptyData: FinanceData = { accounts: [], categories: [], transactions: [], budgets: [], goals: [], recurring: [], investments: [], loans: [], splits: [], notifications: [] };
const today = new Date();
const dateOffset = (days: number) => { const d = new Date(today); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

const demoCategories: FinanceCategory[] = [
  { id: 'cat-food', user_id: 'demo', name: 'Food & dining', kind: 'expense', color: '#f29b72', icon: '◒' },
  { id: 'cat-house', user_id: 'demo', name: 'Housing', kind: 'expense', color: '#9e8be6', icon: '⌂' },
  { id: 'cat-transport', user_id: 'demo', name: 'Transport', kind: 'expense', color: '#69a9d7', icon: '↗' },
  { id: 'cat-salary', user_id: 'demo', name: 'Salary', kind: 'income', color: '#82d84c', icon: '↙' },
  { id: 'cat-shopping', user_id: 'demo', name: 'Shopping', kind: 'expense', color: '#e5a15a', icon: '◇' },
];
const demoAccounts: FinanceAccount[] = [
  { id: 'acc-hdfc', user_id: 'demo', name: 'HDFC Salary Account', account_type: 'bank', institution: 'HDFC Bank', currency_code: 'INR', current_balance: 148620, credit_limit: null, is_archived: false },
  { id: 'acc-cash', user_id: 'demo', name: 'Cash wallet', account_type: 'cash', institution: null, currency_code: 'INR', current_balance: 8200, credit_limit: null, is_archived: false },
  { id: 'acc-amazon', user_id: 'demo', name: 'Amazon Pay', account_type: 'wallet', institution: 'Amazon', currency_code: 'INR', current_balance: 1650, credit_limit: null, is_archived: false },
  { id: 'acc-credit', user_id: 'demo', name: 'ICICI Credit Card', account_type: 'credit_card', institution: 'ICICI Bank', currency_code: 'INR', current_balance: -18740, credit_limit: 150000, is_archived: false },
];
const demoTransactions: FinanceTransaction[] = [
  { id: 'txn-1', user_id: 'demo', account_id: 'acc-hdfc', transfer_account_id: null, category_id: 'cat-salary', type: 'income', amount: 125000, currency_code: 'INR', transaction_date: dateOffset(-1), merchant: 'GCSRV LLC', description: 'Monthly salary', notes: null, tags: ['salary'], is_recurring: true, finance_accounts: { name: 'HDFC Salary Account' }, finance_categories: { name: 'Salary', color: '#82d84c', icon: '↙' } },
  { id: 'txn-2', user_id: 'demo', account_id: 'acc-hdfc', transfer_account_id: null, category_id: 'cat-house', type: 'expense', amount: 28500, currency_code: 'INR', transaction_date: dateOffset(-3), merchant: 'Noida Heights', description: 'Rent payment', notes: null, tags: ['home'], is_recurring: true, finance_accounts: { name: 'HDFC Salary Account' }, finance_categories: { name: 'Housing', color: '#9e8be6', icon: '⌂' } },
  { id: 'txn-3', user_id: 'demo', account_id: 'acc-credit', transfer_account_id: null, category_id: 'cat-food', type: 'expense', amount: 1840, currency_code: 'INR', transaction_date: dateOffset(-4), merchant: 'Swiggy', description: 'Dinner with team', notes: null, tags: ['team'], is_recurring: false, finance_accounts: { name: 'ICICI Credit Card' }, finance_categories: { name: 'Food & dining', color: '#f29b72', icon: '◒' } },
  { id: 'txn-4', user_id: 'demo', account_id: 'acc-hdfc', transfer_account_id: null, category_id: 'cat-transport', type: 'expense', amount: 960, currency_code: 'INR', transaction_date: dateOffset(-6), merchant: 'Uber', description: 'Client meeting', notes: null, tags: ['work'], is_recurring: false, finance_accounts: { name: 'HDFC Salary Account' }, finance_categories: { name: 'Transport', color: '#69a9d7', icon: '↗' } },
  { id: 'txn-5', user_id: 'demo', account_id: 'acc-credit', transfer_account_id: null, category_id: 'cat-shopping', type: 'expense', amount: 3299, currency_code: 'INR', transaction_date: dateOffset(-8), merchant: 'Myntra', description: 'Workwear', notes: null, tags: ['personal'], is_recurring: false, finance_accounts: { name: 'ICICI Credit Card' }, finance_categories: { name: 'Shopping', color: '#e5a15a', icon: '◇' } },
  { id: 'txn-6', user_id: 'demo', account_id: 'acc-hdfc', transfer_account_id: null, category_id: 'cat-food', type: 'expense', amount: 650, currency_code: 'INR', transaction_date: dateOffset(-10), merchant: 'Blue Tokai', description: 'Coffee', notes: null, tags: [], is_recurring: false, finance_accounts: { name: 'HDFC Salary Account' }, finance_categories: { name: 'Food & dining', color: '#f29b72', icon: '◒' } },
];
const demoData: FinanceData = {
  accounts: demoAccounts,
  categories: demoCategories,
  transactions: demoTransactions,
  budgets: [{ id: 'budget-food', category_id: 'cat-food', name: 'Food & dining', month_start: monthStart(), amount: 10000, currency_code: 'INR' }, { id: 'budget-house', category_id: 'cat-house', name: 'Housing', month_start: monthStart(), amount: 30000, currency_code: 'INR' }, { id: 'budget-shop', category_id: 'cat-shopping', name: 'Shopping', month_start: monthStart(), amount: 8000, currency_code: 'INR' }],
  goals: [{ id: 'goal-emergency', name: 'Emergency fund', target_amount: 300000, current_amount: 172500, target_date: dateOffset(180), suggested_monthly_saving: 21250, currency_code: 'INR' }, { id: 'goal-trip', name: 'Japan trip', target_amount: 180000, current_amount: 73500, target_date: dateOffset(270), suggested_monthly_saving: 11800, currency_code: 'INR' }],
  recurring: [{ id: 'bill-rent', name: 'Noida Heights rent', payment_type: 'bill', amount: 28500, currency_code: 'INR', next_due_date: dateOffset(4), is_paid: false, cadence: 'monthly' }, { id: 'bill-notion', name: 'Notion Plus', payment_type: 'subscription', amount: 800, currency_code: 'INR', next_due_date: dateOffset(7), is_paid: false, cadence: 'monthly' }, { id: 'bill-sip', name: 'Index fund SIP', payment_type: 'emi', amount: 15000, currency_code: 'INR', next_due_date: dateOffset(11), is_paid: false, cadence: 'monthly' }],
  investments: [{ id: 'inv-nifty', name: 'Nifty 50 Index Fund', investment_type: 'mutual_fund', symbol: 'NIFTY50', invested_amount: 82000, current_value: 94650, currency_code: 'INR', as_of_date: isoToday() }, { id: 'inv-gold', name: 'Digital gold', investment_type: 'gold', symbol: null, invested_amount: 32500, current_value: 35800, currency_code: 'INR', as_of_date: isoToday() }],
  loans: [{ id: 'loan-1', counterparty_name: 'Aarav', direction: 'lent', principal: 12000, outstanding: 6500, currency_code: 'INR', due_date: dateOffset(22), status: 'open', notes: 'Laptop repair' }],
  splits: [{ id: 'split-1', participant_name: 'Mira', amount: 1450, direction: 'owed_to_me', is_settled: false, transaction_id: 'txn-3' }],
  notifications: [{ id: 'note-1', kind: 'warning', title: 'Food budget is 68% used', body: 'You have ₹3,200 left for the rest of the month.', is_read: false, created_at: new Date().toISOString() }, { id: 'note-2', kind: 'reminder', title: '3 payments due this month', body: 'Rent, Notion, and your SIP are coming up.', is_read: false, created_at: new Date().toISOString() }],
};

const newTransaction = (): TransactionForm => ({ type: 'expense', amount: '', accountId: '', transferAccountId: '', categoryId: '', merchant: '', description: '', transactionDate: isoToday(), tags: '' });
const number = (value: number | string | null | undefined) => Number(value ?? 0);
const dateLabel = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`)) : '—';

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
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [view, setView] = useState<View>('overview');
  const [data, setData] = useState<FinanceData>(emptyData);
  const [localData, setLocalData] = useState<FinanceData>(demoData);
  const [importedData, setImportedData] = useState<ImportData>(emptyImportData);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [darkMode, setDarkMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantQuestion, setAssistantQuestion] = useState('');
  const [assistantAnswer, setAssistantAnswer] = useState('Ask me anything about your money.');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [transactionForm, setTransactionForm] = useState<TransactionForm>(newTransaction());
  const [search, setSearch] = useState('');
  const [transactionFilter, setTransactionFilter] = useState<'all' | 'income' | 'expense' | 'transfer'>('all');
  const [toast, setToast] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const activeData = demoMode ? localData : data;
  const userName = demoMode ? 'Shadma' : String(session?.user.user_metadata?.full_name || session?.user.email?.split('@')[0] || 'there');
  const currentUserId = session?.user.id;

  const refreshData = useCallback(async (userId: string) => {
    setLoading(true);
    setDataError('');
    try {
      let result = await loadFinanceData(userId);
      if (!result.categories.length) {
        await seedFinanceDefaults(userId, session?.user.user_metadata?.full_name || authName || 'Finance owner');
        result = await loadFinanceData(userId);
      }
      setData(result);
      setImportedData(await loadImportData(userId));
    } catch (error) {
      setDataError(error instanceof Error ? error.message : 'We could not load your finance data.');
    } finally {
      setLoading(false);
    }
  }, [authName, session?.user.user_metadata]);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => { setSession(currentSession); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
        setAuthMode('reset');
        setAuthPassword('');
        setAuthMessage('Choose a new password for your workspace.');
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session?.user.id && !demoMode) void refreshData(session.user.id); }, [demoMode, refreshData, session?.user.id]);

  const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3200); };

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAuthError(''); setAuthMessage('');
    if (authMode === 'reset') {
      if (passwordRecovery) {
        if (authPassword.length < 8) { setAuthError('Use at least 8 characters for your new password.'); return; }
        if (!supabase) { setAuthError('Password updates require a connected Supabase project.'); return; }
        setAuthLoading(true); const { error } = await supabase.auth.updateUser({ password: authPassword }); setAuthLoading(false);
        if (error) setAuthError(error.message); else { setPasswordRecovery(false); setAuthMessage('Password updated. Your workspace is ready.'); }
        return;
      }
      if (!authEmail.trim()) { setAuthError('Enter your email first.'); return; }
      if (!supabase) { setAuthMessage('Demo mode does not send emails. Use the demo workspace instead.'); return; }
      setAuthLoading(true); const { error } = await supabase.auth.resetPasswordForEmail(authEmail, { redirectTo: window.location.origin }); setAuthLoading(false);
      if (error) setAuthError(error.message); else setAuthMessage('Reset instructions are on the way. Check your inbox.');
      return;
    }
    if (!authEmail.trim() || !authPassword.trim() || (authMode === 'signup' && !authName.trim())) { setAuthError(authMode === 'signup' ? 'Add your name, email, and password.' : 'Enter your email and password to continue.'); return; }
    if (!supabase) { setDemoMode(true); return; }
    setAuthLoading(true);
    const response = authMode === 'signup'
      ? await supabase.auth.signUp({ email: authEmail, password: authPassword, options: { data: { full_name: authName }, emailRedirectTo: window.location.origin } })
      : await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    setAuthLoading(false);
    if (response.error) { setAuthError(response.error.message); return; }
    if (authMode === 'signup' && !response.data.session) setAuthMessage('Check your email to confirm your account, then sign in.');
    setSession(response.data.session);
  }

  async function logout() {
    if (supabase && session) await supabase.auth.signOut();
    setSession(null); setDemoMode(false); setView('overview'); setData(emptyData); setImportedData(emptyImportData); setImportError(''); setImportMessage(''); showToast('You have been signed out.');
  }

  function startDemo() { setDemoMode(true); setImportedData(emptyImportData); setImportError(''); setImportMessage(''); setAuthMessage(''); setAuthError(''); setView('overview'); }

  async function handleImportFiles(files: File[]) {
    if (!files.length) return;
    setImportLoading(true); setImportError(''); setImportMessage('');
    try {
      const parsedFiles = await Promise.all(files.map((file) => parseImportFile(file)));
      if (demoMode) {
        const existingKeys = new Set([...importedData.payments.map((item) => item.source_key), ...importedData.payouts.map((item) => item.source_key)]);
        const freshParsedFiles = parsedFiles.map((parsed) => ({ ...parsed, payments: parsed.payments.filter((item) => !existingKeys.has(item.source_key)), payouts: parsed.payouts.filter((item) => !existingKeys.has(item.source_key)) }));
        const nextBatches: FinanceImportBatch[] = freshParsedFiles.map((parsed, index) => {
          const analysis = analyzeImportData(parsed);
          const originalCount = parsedFiles[index].payments.length + parsedFiles[index].payouts.length;
          return { id: `demo-import-${Date.now()}-${index}`, user_id: 'demo', file_name: files[index].name, file_type: parsed.file_type, source_kind: parsed.source_kind, file_size: files[index].size, row_count: originalCount, imported_count: analysis.totalRows, duplicate_count: originalCount - analysis.totalRows, total_amount: parsed.source_kind === 'payment_transactions' ? analysis.grossVolume : analysis.payoutTotal, total_fee: parsed.source_kind === 'payment_transactions' ? analysis.paymentFees : analysis.payoutFees, total_net: parsed.source_kind === 'payment_transactions' ? analysis.paymentNet : analysis.payoutTotal, currency_code: analysis.currency, status: 'completed', imported_at: new Date().toISOString() };
        });
        const importedTransactions: FinanceTransaction[] = freshParsedFiles.flatMap((parsed, fileIndex) => parsed.payments.map((item, rowIndex) => {
          const expense = item.net.startsWith('-') || item.amount.startsWith('-') || /refund|chargeback|tax|adjustment/.test(item.event_type);
          return { id: `demo-import-transaction-${Date.now()}-${fileIndex}-${rowIndex}`, user_id: 'demo', account_id: 'demo-imported-account', transfer_account_id: null, category_id: expense ? 'demo-import-expense' : 'demo-import-income', type: expense ? 'expense' : 'income', amount: Math.abs(number(item.net || item.amount)), currency_code: item.currency, transaction_date: item.transaction_date, merchant: item.payment_method_name || item.event_type, description: `${item.event_type}${item.order_id ? ` · ${item.order_id}` : ''}`, notes: `Imported from ${files[fileIndex].name}`, tags: ['imported', item.event_type], is_recurring: false, finance_accounts: { name: 'Imported payment activity' }, finance_categories: { name: expense ? 'Refunds & adjustments' : 'Payment revenue', color: expense ? '#e5a15a' : '#82d84c', icon: expense ? '↗' : '↙' } };
        }));
        const importedNet = freshParsedFiles.flatMap((item) => item.payments).reduce((sum, item) => sum + number(item.net), 0);
        setImportedData((current) => ({ batches: [...nextBatches, ...current.batches], payments: [...freshParsedFiles.flatMap((item) => item.payments), ...current.payments], payouts: [...freshParsedFiles.flatMap((item) => item.payouts), ...current.payouts] }));
        setLocalData((current) => ({ ...current, accounts: current.accounts.some((item) => item.id === 'demo-imported-account') ? current.accounts.map((item) => item.id === 'demo-imported-account' ? { ...item, current_balance: number(item.current_balance) + importedNet } : item) : [...current.accounts, { id: 'demo-imported-account', user_id: 'demo', name: 'Imported payment activity', account_type: 'bank', institution: 'Payment processor exports', currency_code: freshParsedFiles.flatMap((item) => item.payments)[0]?.currency || 'USD', current_balance: importedNet, credit_limit: null, is_archived: false }], categories: [...current.categories.filter((item) => !['demo-import-income', 'demo-import-expense'].includes(item.id)), { id: 'demo-import-income', user_id: 'demo', name: 'Payment revenue', kind: 'income', color: '#82d84c', icon: '↙' }, { id: 'demo-import-expense', user_id: 'demo', name: 'Refunds & adjustments', kind: 'expense', color: '#e5a15a', icon: '↗' }], transactions: [...importedTransactions, ...current.transactions] }));
        const totalImported = freshParsedFiles.reduce((sum, item) => sum + item.payments.length + item.payouts.length, 0);
        const duplicateCount = parsedFiles.reduce((sum, item) => sum + item.payments.length + item.payouts.length, 0) - totalImported;
        setImportMessage(`${totalImported} records analysed in demo mode${duplicateCount ? `; ${duplicateCount} duplicates skipped` : ''}. Sign in to persist them to your workspace.`);
      } else if (supabase && currentUserId) {
        let importedPayments = 0; let importedPayouts = 0; let duplicates = 0;
        for (let index = 0; index < parsedFiles.length; index += 1) {
          const result = await persistParsedImport(currentUserId, files[index], parsedFiles[index]);
          importedPayments += result.importedPayments; importedPayouts += result.importedPayouts; duplicates += result.duplicateCount;
        }
        setImportedData(await loadImportData(currentUserId));
        await refreshData(currentUserId);
        setImportMessage(`${importedPayments + importedPayouts} new records imported. ${duplicates ? `${duplicates} duplicates skipped.` : 'No duplicates found.'}`);
      } else {
        throw new Error('Sign in to import data into your workspace, or use the demo workspace to preview the analysis.');
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'We could not read that file.');
    } finally {
      setImportLoading(false);
    }
  }

  const stats = useMemo(() => {
    const income = activeData.transactions.filter((t) => t.type === 'income').reduce((sum, t) => sum + number(t.amount), 0);
    const expenses = activeData.transactions.filter((t) => t.type === 'expense').reduce((sum, t) => sum + number(t.amount), 0);
    const balance = activeData.accounts.reduce((sum, account) => sum + number(account.current_balance), 0);
    const investmentValue = activeData.investments.reduce((sum, investment) => sum + number(investment.current_value), 0);
    return { balance, income, expenses, savings: income - expenses, investmentValue, savingsRate: income ? Math.round(((income - expenses) / income) * 100) : 0 };
  }, [activeData]);

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
    const haystack = `${transaction.merchant || ''} ${transaction.description || ''} ${transaction.finance_categories?.name || ''} ${transaction.tags.join(' ')}`.toLowerCase();
    return (transactionFilter === 'all' || transaction.type === transactionFilter) && haystack.includes(search.toLowerCase());
  }), [activeData.transactions, search, transactionFilter]);

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
    if (!transactionForm.amount || !transactionForm.accountId) { showToast('Choose an account and amount first.'); return; }
    const payload = { type: transactionForm.type, amount: asMoneyString(transactionForm.amount), account_id: transactionForm.accountId, transfer_account_id: transactionForm.transferAccountId || null, category_id: transactionForm.categoryId || null, merchant: transactionForm.merchant || null, description: transactionForm.description || null, transaction_date: transactionForm.transactionDate, tags: transactionForm.tags.split(',').map((tag) => tag.trim()).filter(Boolean), currency_code: 'INR', user_id: currentUserId };
    if (demoMode) {
      const account = activeData.accounts.find((item) => item.id === transactionForm.accountId);
      const category = activeData.categories.find((item) => item.id === transactionForm.categoryId);
      const localTransaction: FinanceTransaction = { ...payload, id: `demo-${Date.now()}`, user_id: 'demo', amount: payload.amount, account_id: payload.account_id, transfer_account_id: payload.transfer_account_id, category_id: payload.category_id, type: payload.type, currency_code: 'INR', transaction_date: payload.transaction_date, merchant: payload.merchant, description: payload.description, notes: null, tags: payload.tags, is_recurring: false, finance_accounts: account ? { name: account.name } : null, finance_categories: category ? { name: category.name, color: category.color, icon: category.icon } : null };
      setLocalData((current) => ({ ...current, transactions: [localTransaction, ...current.transactions] }));
    } else if (supabase && currentUserId) {
      const { error } = await supabase.from('finance_transactions').insert(payload); if (error) { showToast(error.message); return; } await refreshData(currentUserId);
    }
    setModal(null); setTransactionForm(newTransaction()); showToast('Transaction added to your books.');
  }

  async function deleteTransaction() {
    if (!confirmDelete) return;
    if (demoMode) setLocalData((current) => ({ ...current, transactions: current.transactions.filter((item) => item.id !== confirmDelete) }));
    else if (supabase && currentUserId) { const { error } = await supabase.from('finance_transactions').delete().eq('id', confirmDelete).eq('user_id', currentUserId); if (error) { showToast(error.message); return; } await refreshData(currentUserId); }
    setConfirmDelete(null); showToast('Transaction deleted.');
  }

  async function addAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name') || ''); const accountType = String(form.get('accountType') || 'bank') as FinanceAccount['account_type']; const opening = asMoneyString(String(form.get('balance') || '0'));
    if (!name) { showToast('Name your account first.'); return; }
    if (demoMode) setLocalData((current) => ({ ...current, accounts: [...current.accounts, { id: `demo-account-${Date.now()}`, user_id: 'demo', name, account_type: accountType, institution: String(form.get('institution') || '') || null, currency_code: 'INR', current_balance: Number(opening), credit_limit: null, is_archived: false }] }));
    else if (supabase && currentUserId) { const { error } = await supabase.from('finance_accounts').insert({ user_id: currentUserId, name, account_type: accountType, institution: String(form.get('institution') || '') || null, current_balance: opening, opening_balance: opening, currency_code: 'INR' }); if (error) { showToast(error.message); return; } await refreshData(currentUserId); }
    setModal(null); showToast('Account added.');
  }

  async function addGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name') || ''); const target = asMoneyString(String(form.get('target') || '0')); const saved = asMoneyString(String(form.get('saved') || '0')); const targetDate = String(form.get('targetDate') || '') || null;
    if (!name || Number(target) <= 0) { showToast('Add a goal name and target amount.'); return; }
    const goal = { id: `demo-goal-${Date.now()}`, user_id: 'demo', name, target_amount: target, current_amount: saved, target_date: targetDate, suggested_monthly_saving: targetDate ? Number(target) / Math.max(1, Math.round((new Date(targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30))) : 0, currency_code: 'INR' } as FinanceGoal;
    if (demoMode) setLocalData((current) => ({ ...current, goals: [...current.goals, goal] }));
    else if (supabase && currentUserId) { const { error } = await supabase.from('finance_goals').insert({ user_id: currentUserId, name, target_amount: target, current_amount: saved, target_date: targetDate, suggested_monthly_saving: goal.suggested_monthly_saving, currency_code: 'INR' }); if (error) { showToast(error.message); return; } await refreshData(currentUserId); }
    setModal(null); showToast('Savings goal created.');
  }

  async function addBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const categoryId = String(form.get('categoryId') || '') || null; const category = activeData.categories.find((item) => item.id === categoryId); const amount = asMoneyString(String(form.get('amount') || '0')); if (Number(amount) <= 0) { showToast('Add a budget amount.'); return; }
    if (demoMode) setLocalData((current) => ({ ...current, budgets: [...current.budgets, { id: `demo-budget-${Date.now()}`, category_id: categoryId, name: category?.name || 'Monthly budget', month_start: monthStart(), amount, currency_code: 'INR' }] }));
    else if (supabase && currentUserId) { const { error } = await supabase.from('finance_budgets').insert({ user_id: currentUserId, category_id: categoryId, name: category?.name || 'Monthly budget', month_start: monthStart(), amount, currency_code: 'INR' }); if (error) { showToast(error.message); return; } await refreshData(currentUserId); }
    setModal(null); showToast('Budget added for this month.');
  }

  async function addBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name') || ''); const amount = asMoneyString(String(form.get('amount') || '0')); const dueDate = String(form.get('dueDate') || isoToday()); const paymentType = String(form.get('paymentType') || 'bill') as RecurringPayment['payment_type']; if (!name || Number(amount) <= 0) { showToast('Add a payment name and amount.'); return; }
    const bill = { id: `demo-bill-${Date.now()}`, name, payment_type: paymentType, amount, currency_code: 'INR', next_due_date: dueDate, is_paid: false, cadence: String(form.get('cadence') || 'monthly') } as RecurringPayment;
    if (demoMode) setLocalData((current) => ({ ...current, recurring: [...current.recurring, bill] }));
    else if (supabase && currentUserId) { const { error } = await supabase.from('finance_recurring_payments').insert({ user_id: currentUserId, name, amount, next_due_date: dueDate, payment_type: paymentType, cadence: String(form.get('cadence') || 'monthly'), currency_code: 'INR' }); if (error) { showToast(error.message); return; } await refreshData(currentUserId); }
    setModal(null); showToast('Recurring payment added.');
  }

  async function addInvestment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name') || ''); const type = String(form.get('type') || 'mutual_fund'); const invested = asMoneyString(String(form.get('invested') || '0')); const currentValue = asMoneyString(String(form.get('currentValue') || invested)); if (!name || Number(invested) <= 0) { showToast('Add an investment name and amount.'); return; }
    const investment = { id: `demo-investment-${Date.now()}`, name, investment_type: type, symbol: String(form.get('symbol') || '') || null, invested_amount: invested, current_value: currentValue, currency_code: 'INR', as_of_date: isoToday() } as FinanceInvestment;
    if (demoMode) setLocalData((current) => ({ ...current, investments: [...current.investments, investment] }));
    else if (supabase && currentUserId) { const { error } = await supabase.from('finance_investments').insert({ user_id: currentUserId, name, investment_type: type, symbol: investment.symbol, invested_amount: invested, current_value: currentValue, currency_code: 'INR', as_of_date: isoToday() }); if (error) { showToast(error.message); return; } await refreshData(currentUserId); }
    setModal(null); showToast('Investment added to your portfolio.');
  }

  async function addLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const counterparty = String(form.get('counterparty') || ''); const direction = String(form.get('direction') || 'lent') as FinanceLoan['direction']; const principal = asMoneyString(String(form.get('principal') || '0')); const outstanding = asMoneyString(String(form.get('outstanding') || principal)); const dueDate = String(form.get('dueDate') || '') || null; const notes = String(form.get('notes') || '') || null;
    if (!counterparty || Number(principal) <= 0) { showToast('Add a person and principal amount.'); return; }
    const loan = { id: `demo-loan-${Date.now()}`, counterparty_name: counterparty, direction, principal, outstanding, currency_code: 'INR', due_date: dueDate, status: 'open', notes } as FinanceLoan;
    if (demoMode) setLocalData((current) => ({ ...current, loans: [...current.loans, loan] }));
    else if (supabase && currentUserId) { const { error } = await supabase.from('finance_loans').insert({ user_id: currentUserId, counterparty_name: counterparty, direction, principal, outstanding, currency_code: 'INR', due_date: dueDate, status: 'open', notes }); if (error) { showToast(error.message); return; } await refreshData(currentUserId); }
    setModal(null); showToast('Lending entry added.');
  }

  async function addSplit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const participant = String(form.get('participant') || ''); const amount = asMoneyString(String(form.get('amount') || '0')); const direction = String(form.get('direction') || 'owed_to_me') as FinanceSplit['direction']; const transactionId = String(form.get('transactionId') || '') || null;
    if (!participant || Number(amount) <= 0) { showToast('Add a person and split amount.'); return; }
    const split = { id: `demo-split-${Date.now()}`, participant_name: participant, amount, direction, is_settled: false, transaction_id: transactionId } as FinanceSplit;
    if (demoMode) setLocalData((current) => ({ ...current, splits: [...current.splits, split] }));
    else if (supabase && currentUserId) { const { error } = await supabase.from('finance_splits').insert({ user_id: currentUserId, participant_name: participant, amount, direction, is_settled: false, transaction_id: transactionId }); if (error) { showToast(error.message); return; } await refreshData(currentUserId); }
    setModal(null); showToast('Split expense added.');
  }

  async function markBillPaid(bill: RecurringPayment) {
    if (demoMode) setLocalData((current) => ({ ...current, recurring: current.recurring.map((item) => item.id === bill.id ? { ...item, is_paid: !item.is_paid } : item) }));
    else if (supabase && currentUserId) { const { error } = await supabase.from('finance_recurring_payments').update({ is_paid: !bill.is_paid }).eq('id', bill.id).eq('user_id', currentUserId); if (error) { showToast(error.message); return; } await refreshData(currentUserId); }
    showToast(bill.is_paid ? 'Payment marked as upcoming.' : 'Payment marked as paid.');
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
    const header = ['Date', 'Type', 'Merchant', 'Category', 'Account', 'Amount', 'Currency'];
    const rows = activeData.transactions.map((transaction) => [transaction.transaction_date, transaction.type, transaction.merchant || '', transaction.finance_categories?.name || '', transaction.finance_accounts?.name || '', String(transaction.amount), transaction.currency_code]);
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `gcs-books-${isoToday()}.csv`; anchor.click(); URL.revokeObjectURL(url); showToast('CSV report downloaded.');
  }

  if ((!session || passwordRecovery) && !demoMode) return <AuthScreen mode={authMode} passwordRecovery={passwordRecovery} onCancelRecovery={() => { setPasswordRecovery(false); setAuthMode('login'); setAuthError(''); setAuthMessage(''); }} setMode={(mode) => { setAuthMode(mode); setAuthError(''); setAuthMessage(''); }} email={authEmail} setEmail={setAuthEmail} password={authPassword} setPassword={setAuthPassword} name={authName} setName={setAuthName} message={authMessage} error={authError} loading={authLoading} onSubmit={handleAuth} onDemo={startDemo} />;
  if (loading && !demoMode) return <LoadingScreen />;

  const currentView = views.find((item) => item.id === view) || views[0];
  return (
    <div className={`finance-app ${darkMode ? 'dark' : ''}`}>
      <Sidebar view={view} setView={(next) => { setView(next); setSidebarOpen(false); }} open={sidebarOpen} onClose={() => setSidebarOpen(false)} onAssistant={() => setAssistantOpen(true)} onLogout={logout} userName={userName} demoMode={demoMode} />
      <div className="finance-main">
        <header className="finance-topbar"><div className="finance-topbar-left"><button className="mobile-nav-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">☰</button><div><div className="finance-breadcrumb">GCS Books <span>/</span> {currentView.label}</div><h1>{view === 'overview' ? `Good morning, ${userName}` : currentView.label}</h1></div></div><div className="finance-topbar-actions"><div className="top-search"><span>⌕</span><input aria-label="Search transactions" placeholder="Search your books" value={search} onChange={(event) => setSearch(event.target.value)} /></div><button className="top-icon-button" aria-label="Toggle dark mode" onClick={() => setDarkMode(!darkMode)}>{darkMode ? '☼' : '☾'}</button><button className="top-icon-button notification-trigger" aria-label="Open notifications" onClick={() => setNotificationsOpen(!notificationsOpen)}>♢{activeData.notifications.some((item) => !item.is_read) && <i />}</button><div className="finance-avatar">{userName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div></div>{notificationsOpen && <NotificationPanel notifications={activeData.notifications} onClose={() => setNotificationsOpen(false)} />}</header>
        <main className="finance-content"><div className="content-toolbar"><div><span className="content-eyebrow">{view === 'overview' ? 'Tuesday, 24 August 2026' : 'Your financial command center'}</span>{view !== 'overview' && <p className="content-subtitle">Everything you need to make calmer money decisions.</p>}</div><div className="content-actions"><button className="secondary-button" onClick={() => setAssistantOpen(true)}><span>✦</span> Ask assistant</button><button className="primary-button" onClick={() => { setTransactionForm({ ...newTransaction(), accountId: activeData.accounts[0]?.id || '', categoryId: activeData.categories.find((item) => item.kind !== 'income')?.id || '' }); setModal('transaction'); }}>+ Add transaction</button></div></div>{dataError && <div className="data-error"><span>!</span>{dataError}<button onClick={() => currentUserId && refreshData(currentUserId)}>Retry</button></div>}{renderView(view, activeData, stats, categorySpend, smartInsights, filteredTransactions, search, transactionFilter, setSearch, setTransactionFilter, setView, setModal, setTransactionForm, markBillPaid, setConfirmDelete, showToast, exportCsv, importedData, handleImportFiles, importLoading, importError, importMessage)}</main>
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
      {toast && <div className="finance-toast"><span>✓</span>{toast}</div>}
    </div>
  );
}

function renderView(view: View, data: FinanceData, stats: { balance: number; income: number; expenses: number; savings: number; investmentValue: number; savingsRate: number }, categorySpend: { name: string; color: string; total: number }[], insights: { kind: string; title: string; body: string; icon: string }[], filteredTransactions: FinanceTransaction[], search: string, transactionFilter: 'all' | 'income' | 'expense' | 'transfer', setSearch: (value: string) => void, setTransactionFilter: (value: 'all' | 'income' | 'expense' | 'transfer') => void, setView: (value: View) => void, setModal: (value: Modal) => void, setTransactionForm: (value: TransactionForm) => void, markBillPaid: (bill: RecurringPayment) => void, setConfirmDelete: (value: string | null) => void, showToast: (value: string) => void, exportCsv: () => void, importedData: ImportData, onImportFiles: (files: File[]) => void, importLoading: boolean, importError: string, importMessage: string) {
  switch (view) {
    case 'transactions': return <TransactionsView data={data} transactions={filteredTransactions} search={search} filter={transactionFilter} setSearch={setSearch} setFilter={setTransactionFilter} setModal={setModal} setTransactionForm={setTransactionForm} setConfirmDelete={setConfirmDelete} />;
    case 'accounts': return <AccountsView data={data} setModal={setModal} />;
    case 'budgets': return <BudgetsView data={data} setModal={setModal} />;
    case 'goals': return <GoalsView data={data} setModal={setModal} />;
    case 'bills': return <BillsView data={data} setModal={setModal} markBillPaid={markBillPaid} />;
    case 'investments': return <InvestmentsView data={data} setModal={setModal} />;
    case 'analytics': return <AnalyticsView data={data} stats={stats} categorySpend={categorySpend} />;
    case 'lending': return <LendingView data={data} setModal={setModal} />;
    case 'reports': return <ReportsView data={data} importedData={importedData} exportCsv={exportCsv} />;
    case 'calendar': return <CalendarView data={data} />;
    case 'imports': return <ImportCenterView importedData={importedData} onImportFiles={onImportFiles} loading={importLoading} error={importError} message={importMessage} />;
    default: return <OverviewView data={data} stats={stats} categorySpend={categorySpend} insights={insights} setView={setView} setModal={setModal} />;
  }
}

function AuthScreen({ mode, passwordRecovery, onCancelRecovery, setMode, email, setEmail, password, setPassword, name, setName, message, error, loading, onSubmit, onDemo }: { mode: AuthMode; passwordRecovery: boolean; onCancelRecovery: () => void; setMode: (mode: AuthMode) => void; email: string; setEmail: (value: string) => void; password: string; setPassword: (value: string) => void; name: string; setName: (value: string) => void; message: string; error: string; loading: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onDemo: () => void }) {
  const reset = mode === 'reset'; const signup = mode === 'signup'; const recovery = reset && passwordRecovery;
   return <main className="auth-shell"><div className="auth-glow auth-glow-one" /><section className="auth-story"><div className="auth-brand-lockup"><div className="brand-mark"><span>G</span></div><div><div className="brand-name">GCS Books</div><div className="brand-subtitle">Global Creative Services</div></div></div><div className="auth-story-copy"><div className="eyebrow auth-eyebrow">Your calmer money practice</div><h1>Know your numbers. Keep your options open.</h1><p>Accounts, bills, goals, and investments in one secure, human workspace built for real life.</p></div><div className="auth-proof-row"><div><strong>INR first</strong><span>multi-currency ready</span></div><div><strong>Private</strong><span>row-level protected</span></div></div></section><section className="auth-card-wrap"><div className="auth-card-topline"><span>GCS Books</span><span><i className="secure-dot" /> Secure workspace</span></div><div className="auth-card"><div className="auth-card-header"><div className="auth-mini-mark">G</div><div className="eyebrow">{recovery ? 'Set a new password' : reset ? 'Account recovery' : signup ? 'Start with a clean slate' : 'Welcome back'}</div><h2>{recovery ? 'Create a new password' : reset ? 'Reset your password' : signup ? 'Create your workspace' : 'Sign in to your books'}</h2><p>{recovery ? 'Choose a strong password to keep your workspace secure.' : reset ? 'We will send a secure reset link to your email.' : signup ? 'Set up your financial home in under two minutes.' : 'Your numbers are ready when you are.'}</p></div>{!reset && <div className="auth-mode-toggle"><button className={!signup ? 'selected' : ''} type="button" onClick={() => setMode('login')}>Sign in</button><button className={signup ? 'selected' : ''} type="button" onClick={() => setMode('signup')}>Create account</button></div>}<form className="auth-form" onSubmit={onSubmit}>{signup && <label className="auth-field"><span>Your name</span><input autoComplete="name" placeholder="Shadma Mittal" value={name} onChange={(event) => setName(event.target.value)} /></label>}{!recovery && <label className="auth-field"><span>Work email</span><input type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>}{(!reset || recovery) && <label className="auth-field"><span>Password</span><input type="password" autoComplete={signup || recovery ? 'new-password' : 'current-password'} placeholder={recovery ? 'Choose a new password' : 'Enter your password'} value={password} onChange={(event) => setPassword(event.target.value)} /></label>}{error && <div className="auth-message"><span>!</span>{error}</div>}{message && <div className="auth-success"><span>✓</span>{message}</div>}<button className="auth-submit" disabled={loading} type="submit">{loading ? 'Working…' : recovery ? 'Update password' : reset ? 'Send reset link' : signup ? 'Create my workspace' : 'Sign in to workspace'}<span>↗</span></button></form>{!reset && <><div className="auth-divider"><span>or</span></div><button className="demo-button" type="button" onClick={onDemo}><span className="demo-icon">✦</span><span><strong>Preview demo workspace</strong><small>Explore the dashboard with sample data</small></span><span className="demo-arrow">↗</span></button></>}<p className="auth-switch">{reset ? <button type="button" onClick={passwordRecovery ? onCancelRecovery : () => setMode('login')}>← Back to sign in</button> : <><button type="button" onClick={() => setMode(signup ? 'login' : 'reset')}>{signup ? 'Already have an account? Sign in' : 'Forgot password?'}</button></>}</p></div><div className="auth-card-footer"><span>◈ Your data stays yours.</span><span>Privacy · Terms</span></div></section></main>;
}

function LoadingScreen() { return <main className="loading-screen"><div className="loading-mark">G</div><div className="loading-line" /><p>Loading your money picture…</p></main>; }

function Sidebar({ view, setView, open, onClose, onAssistant, onLogout, userName, demoMode }: { view: View; setView: (view: View) => void; open: boolean; onClose: () => void; onAssistant: () => void; onLogout: () => void; userName: string; demoMode: boolean }) {
  const groups = [...new Set(views.map((item) => item.group))];
  return <><div className={`sidebar-scrim ${open ? 'show' : ''}`} onClick={onClose} /><aside className={`finance-sidebar ${open ? 'open' : ''}`}><div className="finance-brand"><div className="brand-mark"><span>G</span></div><div><strong>GCS Books</strong><small>Personal finance</small></div></div><button className="workspace-switcher"><span className="workspace-avatar">{userName.slice(0, 2).toUpperCase()}</span><span><strong>{demoMode ? 'Demo workspace' : `${userName}'s finances`}</strong><small>INR · Personal</small></span><span>⌄</span></button><div className="side-scroll">{groups.map((group) => <div className="side-group" key={group}><div className="side-label">{group}</div>{views.filter((item) => item.group === group).map((item) => <button key={item.id} className={`side-item ${view === item.id ? 'active' : ''}`} onClick={() => setView(item.id)}><span>{item.icon}</span>{item.label}{item.id === 'bills' && <i className="side-count">3</i>}</button>)}</div>)}</div><button className="assistant-cta" onClick={onAssistant}><span>✦</span><span><strong>Finance assistant</strong><small>Ask about your money</small></span><b>↗</b></button><div className="side-user"><div className="finance-avatar">{userName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div><span><strong>{userName}</strong><small>{demoMode ? 'Demo mode' : 'Signed in'}</small></span><button aria-label="Sign out" onClick={onLogout}>↪</button></div></aside></>;
}

function OverviewView({ data, stats, categorySpend, insights, setView, setModal }: { data: FinanceData; stats: { balance: number; income: number; expenses: number; savings: number; investmentValue: number; savingsRate: number }; categorySpend: { name: string; color: string; total: number }[]; insights: { kind: string; title: string; body: string; icon: string }[]; setView: (view: View) => void; setModal: (modal: Modal) => void }) {
  const maxBar = Math.max(...data.transactions.map((item) => number(item.amount)), 1);
  return <div className="view-stack"><section className="insight-strip"><div className="insight-symbol">✦</div><div><strong>{stats.savingsRate >= 20 ? 'Your money picture is looking healthy.' : 'A small review today can create breathing room.'}</strong><p>You are saving {stats.savingsRate}% of your income in this view.</p></div><button onClick={() => setView('analytics')}>See the story ↗</button></section><section className="kpi-grid"><KpiCard label="Total balance" value={money(stats.balance)} meta="across all accounts" tone="green" symbol="◈" /><KpiCard label="Income this month" value={money(stats.income)} meta="money in" tone="blue" symbol="↙" /><KpiCard label="Expenses this month" value={money(stats.expenses)} meta="money out" tone="orange" symbol="↗" /><KpiCard label="Savings rate" value={`${stats.savingsRate}%`} meta={`${money(stats.savings)} saved`} tone="violet" symbol="◎" /></section><div className="overview-grid"><section className="finance-card cash-card"><CardHeading eyebrow="Flow" title="Income vs expenses" action="Analytics" onAction={() => setView('analytics')} /><div className="chart-meta"><span><i className="legend-income" /> Income</span><span><i className="legend-expense" /> Expenses</span><strong>{money(stats.savings)} net savings</strong></div><div className="flow-chart">{[1, 2, 3, 4, 5, 6].map((index) => { const income = data.transactions.filter((item) => item.type === 'income')[index - 1]?.amount || (index === 6 ? stats.income : 0); const expense = data.transactions.filter((item) => item.type === 'expense')[index - 1]?.amount || (index === 6 ? stats.expenses : 0); return <div className="flow-column" key={index}><div className="flow-bars"><span className="income-bar" style={{ height: `${Math.max(10, number(income) / maxBar * 100)}%` }} /><span className="expense-bar" style={{ height: `${Math.max(8, number(expense) / maxBar * 100)}%` }} /></div><small>{['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'][index - 1]}</small></div>; })}</div></section><section className="finance-card category-card"><CardHeading eyebrow="Where it goes" title="Spending by category" action="Details" onAction={() => setView('analytics')} /><div className="donut-wrap"><div className="donut" style={{ background: categorySpend.length ? `conic-gradient(${categorySpend.slice(0, 4).map((item, index) => `${item.color} ${index * 25}% ${(index + 1) * 25}%`).join(', ')})` : '#e9efe8' }}><div><strong>{money(stats.expenses)}</strong><small>spent</small></div></div><div className="category-list">{categorySpend.slice(0, 4).map((item) => <div key={item.name}><span><i style={{ background: item.color }} />{item.name}</span><strong>{Math.round(item.total / Math.max(stats.expenses, 1) * 100)}%</strong></div>)}</div></div></section></div><div className="overview-grid lower"><section className="finance-card"><CardHeading eyebrow="Coming up" title="Bills & subscriptions" action="View all" onAction={() => setView('bills')} /><div className="bill-list">{data.recurring.slice(0, 3).map((bill) => <div className="bill-row" key={bill.id}><div className="bill-icon">{bill.payment_type === 'subscription' ? '◉' : bill.payment_type === 'emi' ? '↗' : '□'}</div><div><strong>{bill.name}</strong><small>{dateLabel(bill.next_due_date)} · {bill.cadence}</small></div><strong className="bill-amount">{money(bill.amount)}</strong><span className={`bill-status ${bill.is_paid ? 'paid' : ''}`}>{bill.is_paid ? 'Paid' : 'Due'}</span></div>)}{!data.recurring.length && <EmptyState title="No upcoming payments" body="Add rent, EMIs, subscriptions, and more." action="Add payment" onAction={() => setModal('bill')} />}</div></section><section className="finance-card"><CardHeading eyebrow="Goals" title="Savings progress" action="Manage" onAction={() => setView('goals')} /><div className="goal-mini-list">{data.goals.slice(0, 2).map((goal) => <div className="goal-mini" key={goal.id}><div className="goal-mini-top"><span><i className="goal-dot" />{goal.name}</span><strong>{Math.round(number(goal.current_amount) / Math.max(number(goal.target_amount), 1) * 100)}%</strong></div><div className="progress-track"><span style={{ width: `${Math.min(100, number(goal.current_amount) / Math.max(number(goal.target_amount), 1) * 100)}%` }} /></div><small>{money(goal.current_amount)} of {money(goal.target_amount)} · {money(goal.suggested_monthly_saving)}/mo suggested</small></div>)}{!data.goals.length && <EmptyState title="Give your next goal a name" body="Build a travel fund, emergency buffer, or anything in between." action="Create goal" onAction={() => setModal('goal')} />}</div></section></div><section className="finance-card insight-card"><CardHeading eyebrow="Smart insights" title="Small observations, useful next steps" action="Ask assistant" onAction={() => setView('analytics')} /><div className="insight-grid">{insights.map((insight) => <div className={`smart-insight ${insight.kind}`} key={insight.title}><span>{insight.icon}</span><div><strong>{insight.title}</strong><p>{insight.body}</p></div></div>)}</div></section><section className="finance-card recent-card"><CardHeading eyebrow="Latest activity" title="Recent transactions" action="See all" onAction={() => setView('transactions')} /><TransactionTable transactions={data.transactions.slice(0, 5)} onDelete={() => undefined} /></section></div>;
}

function KpiCard({ label, value, meta, tone, symbol }: { label: string; value: string; meta: string; tone: string; symbol: string }) { return <article className="kpi-card"><div className={`kpi-symbol ${tone}`}>{symbol}</div><span>{label}</span><strong>{value}</strong><small>{meta}</small></article>; }
function CardHeading({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action?: string; onAction?: () => void }) { return <div className="card-heading"><div><span>{eyebrow}</span><h2>{title}</h2></div>{action && <button onClick={onAction}>{action} ↗</button>}</div>; }
function EmptyState({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) { return <div className="empty-state"><div className="empty-symbol">◌</div><strong>{title}</strong><p>{body}</p>{action && <button onClick={onAction}>{action} +</button>}</div>; }

function TransactionsView({ data, transactions, search, filter, setSearch, setFilter, setModal, setTransactionForm, setConfirmDelete }: { data: FinanceData; transactions: FinanceTransaction[]; search: string; filter: 'all' | 'income' | 'expense' | 'transfer'; setSearch: (value: string) => void; setFilter: (value: 'all' | 'income' | 'expense' | 'transfer') => void; setModal: (modal: Modal) => void; setTransactionForm: (form: TransactionForm) => void; setConfirmDelete: (id: string | null) => void }) {
  return <div className="view-stack"><section className="module-header"><div><span className="content-eyebrow">Your money, item by item</span><h2>Transactions</h2><p>Search, filter, and keep the details tidy.</p></div><button className="primary-button" onClick={() => { setTransactionForm({ ...newTransaction(), accountId: data.accounts[0]?.id || '', categoryId: data.categories.find((item) => item.kind !== 'income')?.id || '' }); setModal('transaction'); }}>+ Add transaction</button></section><section className="finance-card"><div className="filter-bar"><div className="inline-search"><span>⌕</span><input placeholder="Search merchant, category, or tag" value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="filter-pills">{(['all', 'income', 'expense', 'transfer'] as const).map((item) => <button className={filter === item ? 'active' : ''} key={item} onClick={() => setFilter(item)}>{item === 'all' ? 'All activity' : item[0].toUpperCase() + item.slice(1)}</button>)}</div><button className="filter-icon">≡ Filters</button></div><TransactionTable transactions={transactions} onDelete={setConfirmDelete} /><p className="table-footnote">Showing {transactions.length} of {data.transactions.length} transactions · Amounts are stored as exact decimal values.</p></section></div>;
}

function TransactionTable({ transactions, onDelete }: { transactions: FinanceTransaction[]; onDelete: (id: string) => void }) { return <div className="transaction-table"><div className="transaction-head"><span>Transaction</span><span>Account</span><span>Date</span><span>Amount</span><span /></div>{transactions.map((transaction) => <div className="transaction-row" key={transaction.id}><div className="transaction-name"><span className={`transaction-icon ${transaction.type}`}>{transaction.type === 'income' ? '↙' : transaction.type === 'transfer' ? '⇄' : transaction.finance_categories?.icon || '◒'}</span><span><strong>{transaction.merchant || transaction.description || 'Untitled transaction'}</strong><small>{transaction.finance_categories?.name || 'Uncategorized'} {transaction.tags.length ? `· ${transaction.tags.join(', ')}` : ''}</small></span></div><span className="transaction-account">{transaction.finance_accounts?.name || '—'}</span><span className="transaction-date">{dateLabel(transaction.transaction_date)}</span><strong className={`transaction-amount ${transaction.type}`}>{transaction.type === 'expense' ? '−' : '+'}{moneyExact(transaction.amount, transaction.currency_code)}</strong><button className="row-menu" aria-label={`Delete ${transaction.merchant || 'transaction'}`} onClick={() => onDelete(transaction.id)}>•••</button></div>)}{!transactions.length && <EmptyState title="No matching transactions" body="Add your first income or expense to start seeing patterns." />}</div>; }

function AccountsView({ data, setModal }: { data: FinanceData; setModal: (modal: Modal) => void }) { const total = data.accounts.reduce((sum, account) => sum + number(account.current_balance), 0); return <div className="view-stack"><section className="module-header"><div><span className="content-eyebrow">One picture, every pocket</span><h2>Accounts</h2><p>{data.accounts.length} connected accounts · {money(total)} total balance</p></div><button className="primary-button" onClick={() => setModal('account')}>+ Add account</button></section><section className="account-grid">{data.accounts.map((account) => <article className={`account-card ${account.account_type}`} key={account.id}><div className="account-card-top"><span className="account-type-icon">{account.account_type === 'credit_card' ? '▱' : account.account_type === 'cash' ? '◌' : account.account_type === 'wallet' ? '▣' : '▤'}</span><button>•••</button></div><span>{account.institution || account.account_type.replace('_', ' ')}</span><h3>{account.name}</h3><strong>{moneyExact(account.current_balance, account.currency_code)}</strong><small>{account.account_type === 'credit_card' ? `of ${money(account.credit_limit)} limit` : account.currency_code}</small></article>)}{!data.accounts.length && <div className="wide-empty"><EmptyState title="Connect your first account" body="Start with a bank, cash wallet, credit card, or savings account." action="Add account" onAction={() => setModal('account')} /></div>}</section></div>; }

function BudgetsView({ data, setModal }: { data: FinanceData; setModal: (modal: Modal) => void }) { return <div className="view-stack"><section className="module-header"><div><span className="content-eyebrow">Give your money a job</span><h2>Budgets</h2><p>Monthly guardrails that adapt to real life.</p></div><button className="primary-button" onClick={() => setModal('budget')}>+ Set budget</button></section><section className="budget-grid">{data.budgets.map((budget) => { const used = data.transactions.filter((t) => t.type === 'expense' && t.category_id === budget.category_id).reduce((sum, t) => sum + number(t.amount), 0); const percent = Math.min(100, used / Math.max(number(budget.amount), 1) * 100); return <article className={`budget-card ${percent >= 90 ? 'danger' : percent >= 75 ? 'warning' : ''}`} key={budget.id}><div className="budget-top"><div><span className="content-eyebrow">Monthly budget</span><h3>{budget.name}</h3></div><strong>{Math.round(percent)}%</strong></div><div className="progress-track"><span style={{ width: `${percent}%` }} /></div><div className="budget-bottom"><span>{money(used)} used</span><strong>{money(Math.max(0, number(budget.amount) - used))} left</strong></div>{percent >= 90 && <div className="budget-alert">!</div>}</article>; })}{!data.budgets.length && <div className="wide-empty"><EmptyState title="No budgets yet" body="Create a few soft limits for the categories that matter most." action="Set a budget" onAction={() => setModal('budget')} /></div>}</section></div>; }

function GoalsView({ data, setModal }: { data: FinanceData; setModal: (modal: Modal) => void }) { return <div className="view-stack"><section className="module-header"><div><span className="content-eyebrow">Future you will thank you</span><h2>Savings goals</h2><p>Make progress visible and the next deposit obvious.</p></div><button className="primary-button" onClick={() => setModal('goal')}>+ Create goal</button></section><section className="goal-grid">{data.goals.map((goal) => { const percent = Math.min(100, number(goal.current_amount) / Math.max(number(goal.target_amount), 1) * 100); return <article className="goal-card" key={goal.id}><div className="goal-card-head"><div className="goal-orbit">◎</div><span>{goal.target_date ? `${Math.ceil((new Date(goal.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))} days left` : 'No target date'}</span></div><h3>{goal.name}</h3><strong>{money(goal.current_amount)}</strong><span>of {money(goal.target_amount)}</span><div className="progress-track"><span style={{ width: `${percent}%` }} /></div><div className="goal-card-foot"><span>{Math.round(percent)}% complete</span><strong>{money(goal.suggested_monthly_saving)}/mo suggested</strong></div></article>; })}{!data.goals.length && <div className="wide-empty"><EmptyState title="Name your next milestone" body="A goal turns spare cash into a plan you can feel." action="Create goal" onAction={() => setModal('goal')} /></div>}</section></div>; }

function BillsView({ data, setModal, markBillPaid }: { data: FinanceData; setModal: (modal: Modal) => void; markBillPaid: (bill: RecurringPayment) => void }) { const total = data.recurring.filter((bill) => !bill.is_paid).reduce((sum, bill) => sum + number(bill.amount), 0); return <div className="view-stack"><section className="module-header"><div><span className="content-eyebrow">Never miss the quiet commitments</span><h2>Bills & subscriptions</h2><p>{money(total)} due across {data.recurring.length} recurring payments.</p></div><button className="primary-button" onClick={() => setModal('bill')}>+ Add payment</button></section><section className="finance-card"><div className="list-summary"><div><span>Coming up</span><strong>{data.recurring.filter((bill) => !bill.is_paid).length}</strong></div><div><span>Subscriptions</span><strong>{data.recurring.filter((bill) => bill.payment_type === 'subscription').length}</strong></div><div><span>Monthly commitment</span><strong>{money(total)}</strong></div></div><div className="recurring-table"><div className="transaction-head"><span>Payment</span><span>Type</span><span>Due date</span><span>Amount</span><span /></div>{data.recurring.map((bill) => <div className="transaction-row" key={bill.id}><div className="transaction-name"><span className="transaction-icon recurring">◷</span><span><strong>{bill.name}</strong><small>Every {bill.cadence}</small></span></div><span className="pill-soft">{bill.payment_type}</span><span className="transaction-date">{dateLabel(bill.next_due_date)}</span><strong className="transaction-amount expense">−{moneyExact(bill.amount)}</strong><button className={`paid-toggle ${bill.is_paid ? 'checked' : ''}`} onClick={() => markBillPaid(bill)}>{bill.is_paid ? 'Paid ✓' : 'Mark paid'}</button></div>)}{!data.recurring.length && <EmptyState title="No recurring payments" body="Track rent, subscriptions, EMIs, and reminders here." action="Add payment" onAction={() => setModal('bill')} />}</div></section></div>; }

function InvestmentsView({ data, setModal }: { data: FinanceData; setModal: (modal: Modal) => void }) { const invested = data.investments.reduce((sum, item) => sum + number(item.invested_amount), 0); const current = data.investments.reduce((sum, item) => sum + number(item.current_value), 0); return <div className="view-stack"><section className="module-header"><div><span className="content-eyebrow">Let your money compound</span><h2>Investments</h2><p>{data.investments.length} holdings · {money(current - invested)} unrealized gain.</p></div><button className="primary-button" onClick={() => setModal('investment')}>+ Add investment</button></section><section className="investment-summary"><div><span>Invested</span><strong>{money(invested)}</strong></div><div><span>Current value</span><strong>{money(current)}</strong></div><div><span>Profit / loss</span><strong className={current >= invested ? 'positive' : 'negative'}>{current >= invested ? '+' : '−'}{money(Math.abs(current - invested))}</strong></div></section><section className="finance-card"><div className="investment-table"><div className="transaction-head"><span>Holding</span><span>Type</span><span>As of</span><span>Current value</span><span /></div>{data.investments.map((investment) => <div className="transaction-row" key={investment.id}><div className="transaction-name"><span className="investment-icon">↗</span><span><strong>{investment.name}</strong><small>{investment.symbol || 'Long-term holding'}</small></span></div><span className="pill-soft">{investment.investment_type.replace('_', ' ')}</span><span className="transaction-date">{dateLabel(investment.as_of_date)}</span><strong className="transaction-amount">{moneyExact(investment.current_value)}</strong><span className={number(investment.current_value) >= number(investment.invested_amount) ? 'positive' : 'negative'}>{number(investment.current_value) >= number(investment.invested_amount) ? '+' : '−'}{money(Math.abs(number(investment.current_value) - number(investment.invested_amount)))}</span></div>)}{!data.investments.length && <EmptyState title="Your portfolio starts here" body="Track stocks, mutual funds, SIPs, gold, FDs, crypto, and more." action="Add investment" onAction={() => setModal('investment')} />}</div></section></div>; }

function AnalyticsView({ data, stats, categorySpend }: { data: FinanceData; stats: { income: number; expenses: number; savings: number; savingsRate: number }; categorySpend: { name: string; color: string; total: number }[] }) { const top = Math.max(...categorySpend.map((item) => item.total), 1); return <div className="view-stack"><section className="module-header"><div><span className="content-eyebrow">Your patterns, not just your totals</span><h2>Analytics</h2><p>Understand the decisions behind the numbers.</p></div><div className="month-selector">August 2026 ⌄</div></section><section className="analytics-kpis"><KpiCard label="Savings rate" value={`${stats.savingsRate}%`} meta="income kept" tone="green" symbol="◎" /><KpiCard label="Largest category" value={categorySpend[0]?.name || '—'} meta={categorySpend[0] ? money(categorySpend[0].total) : 'Add expenses'} tone="orange" symbol="◒" /><KpiCard label="Invested" value={money(data.investments.reduce((sum, item) => sum + number(item.current_value), 0))} meta="current portfolio value" tone="violet" symbol="↗" /></section><div className="analytics-grid"><section className="finance-card"><CardHeading eyebrow="Category view" title="Where your money went" /><div className="horizontal-bars">{categorySpend.map((item) => <div className="horizontal-row" key={item.name}><div><span>{item.name}</span><strong>{money(item.total)}</strong></div><div className="horizontal-track"><span style={{ width: `${item.total / top * 100}%`, background: item.color }} /></div></div>)}{!categorySpend.length && <EmptyState title="Analytics need a little activity" body="Add a few transactions to see your patterns." />}</div></section><section className="finance-card"><CardHeading eyebrow="Monthly trend" title="Money in vs money out" /><div className="trend-lines"><div className="trend-line income-trend" style={{ height: '74%' }} /><div className="trend-line expense-trend" style={{ height: '38%' }} /><div className="trend-line income-trend" style={{ height: '88%' }} /><div className="trend-line expense-trend" style={{ height: '50%' }} /><div className="trend-line income-trend" style={{ height: '66%' }} /><div className="trend-line expense-trend" style={{ height: '46%' }} /></div><div className="trend-labels"><span>Jun</span><span>Jul</span><span>Aug</span></div><div className="chart-meta"><span><i className="legend-income" /> Income {money(stats.income)}</span><span><i className="legend-expense" /> Expenses {money(stats.expenses)}</span></div></section></div></div>; }

function LendingView({ data, setModal }: { data: FinanceData; setModal: (modal: Modal) => void }) { const outstanding = data.loans.reduce((sum, item) => sum + number(item.outstanding), 0) + data.splits.filter((item) => !item.is_settled).reduce((sum, item) => sum + number(item.amount), 0); return <div className="view-stack"><section className="module-header"><div><span className="content-eyebrow">Keep the relationship, remember the number</span><h2>Lending & splits</h2><p>{money(outstanding)} still in motion across friends, family, and shared expenses.</p></div><button className="primary-button" onClick={() => setModal('loan')}>+ Add lending entry</button></section><div className="lending-grid"><section className="finance-card"><CardHeading eyebrow="Loans" title="Lent & borrowed" action="Add loan" onAction={() => setModal('loan')} /><div className="loan-list">{data.loans.map((loan) => <div className="loan-row" key={loan.id}><span className={`loan-icon ${loan.direction}`}>{loan.direction === 'lent' ? '↗' : '↙'}</span><div><strong>{loan.counterparty_name}</strong><small>{loan.direction === 'lent' ? 'Owes you' : 'You owe'} · {loan.status}</small></div><strong>{money(loan.outstanding)}</strong></div>)}{!data.loans.length && <EmptyState title="No loans tracked" body="Keep personal lending clear and kind." action="Add loan" onAction={() => setModal('loan')} />}</div></section><section className="finance-card"><CardHeading eyebrow="Shared expenses" title="Who owes what" action="Add split" onAction={() => setModal('split')} /><div className="loan-list">{data.splits.map((split) => <div className="loan-row" key={split.id}><span className="loan-icon split">⇄</span><div><strong>{split.participant_name}</strong><small>{split.is_settled ? 'Settled' : split.direction === 'owed_to_me' ? 'Owes you' : 'You owe'}</small></div><strong className={split.is_settled ? 'muted' : ''}>{money(split.amount)}</strong></div>)}{!data.splits.length && <EmptyState title="No split expenses" body="Split a meal, trip, or household cost when you need to." action="Add split" onAction={() => setModal('split')} />}</div></section></div></div>; }

function ReportsView({ data, importedData, exportCsv }: { data: FinanceData; importedData: ImportData; exportCsv: () => void }) {
  const analysis = analyzeImportData(importedData);
  return <div className="view-stack"><section className="module-header"><div><span className="content-eyebrow">A clear record when you need it</span><h2>Reports</h2><p>Export your financial history for review, tax time, or a planning conversation.</p></div><div className="content-actions"><button className="secondary-button" onClick={() => window.print()}>Export PDF</button><button className="primary-button" onClick={exportCsv}>Download CSV</button></div></section><section className="report-card"><div className="report-hero"><div className="report-mark">▦</div><div><span className="content-eyebrow">August 2026 snapshot</span><h3>Monthly money report</h3><p>Income, expenses, savings, and transaction history in a portable format.</p></div></div><div className="report-stat-row"><div><span>Total income</span><strong>{money(data.transactions.filter((t) => t.type === 'income').reduce((sum, t) => sum + number(t.amount), 0))}</strong></div><div><span>Total expenses</span><strong>{money(data.transactions.filter((t) => t.type === 'expense').reduce((sum, t) => sum + number(t.amount), 0))}</strong></div><div><span>Records</span><strong>{data.transactions.length}</strong></div></div></section>{importedData.batches.length > 0 && <section className="finance-card imported-report-card"><CardHeading eyebrow="Imported exports" title="Settlement reconciliation" /><div className="report-stat-row"><div><span>Payment rows</span><strong>{analysis.paymentRows}</strong></div><div><span>Payout rows</span><strong>{analysis.payoutRows}</strong></div><div><span>Settlement gap</span><strong className={Math.abs(analysis.reconciliationDifference) < 0.01 ? 'positive' : 'negative'}>{moneyExact(analysis.reconciliationDifference, analysis.currency)}</strong></div></div><p className="muted-copy">Imported data is kept alongside your manually entered records, with source files and payout references preserved for audit review.</p></section>}</div>;
}

function ImportCenterView({ importedData, onImportFiles, loading, error, message }: { importedData: ImportData; onImportFiles: (files: File[]) => void; loading: boolean; error: string; message: string }) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const analysis = analyzeImportData(importedData);
  const currency = analysis.currency || 'USD';
  const chooseFiles = (fileList: FileList | null) => setSelectedFiles(Array.from(fileList ?? []).filter((file) => /\.(csv|pdf)$/i.test(file.name)));
  const removeFile = (name: string) => setSelectedFiles((current) => current.filter((file) => file.name !== name));
  const importFiles = () => { if (selectedFiles.length) { onImportFiles(selectedFiles); setSelectedFiles([]); } };
  const paymentRows = importedData.payments.slice(0, 25);
  const payoutRows = importedData.payouts.slice(0, 20);
  return <div className="view-stack import-view"><section className="module-header"><div><span className="content-eyebrow">Understand exports in context</span><h2>Import center</h2><p>Bring payment and payout exports into your books. Every row is parsed, reconciled, searchable, and linked back to its source.</p></div><div className="import-source-badge"><span>CSV + PDF</span><small>Source-aware import</small></div></section><section className="import-layout"><div className="finance-card import-uploader"><div className="import-dropzone"><input aria-label="Choose CSV or PDF files" type="file" accept=".csv,.pdf,text/csv,application/pdf" multiple onChange={(event) => chooseFiles(event.target.files)} /><span className="import-upload-icon">⇧</span><strong>Drop exports here or choose files</strong><small>Payment transaction CSVs and text-based payout PDFs are supported.</small><em>Files stay in your workspace and imported records are user-scoped.</em></div>{selectedFiles.length > 0 && <div className="import-file-list"><div className="import-section-label">Ready to analyse</div>{selectedFiles.map((file) => <div className="import-file-row" key={`${file.name}-${file.size}`}><span className="file-type-pill">{file.name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'CSV'}</span><div><strong>{file.name}</strong><small>{Math.round(file.size / 1024)} KB</small></div><button aria-label={`Remove ${file.name}`} onClick={() => removeFile(file.name)}>×</button></div>)}<button className="primary-button import-action" disabled={loading} onClick={importFiles}>{loading ? 'Reading files…' : `Analyse & import ${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} ↗`}</button></div>}{error && <div className="import-feedback error"><span>!</span>{error}</div>}{message && <div className="import-feedback success"><span>✓</span>{message}</div>}</div><section className="finance-card import-how-card"><CardHeading eyebrow="What gets connected" title="One import, many views" /><div className="import-connection-list"><div><span>01</span><p><strong>Transactions</strong><small>Income, refunds, chargebacks, fees, and taxes are categorised into your transaction ledger.</small></p></div><div><span>02</span><p><strong>Reports</strong><small>Gross volume, net proceeds, payout totals, and reconciliation differences stay visible.</small></p></div><div><span>03</span><p><strong>Analytics</strong><small>Events, statuses, monthly trends, top orders, and settlement activity become queryable insights.</small></p></div></div></section></section>{importedData.batches.length > 0 && <><section className="import-kpi-grid"><KpiCard label="Imported records" value={String(analysis.totalRows)} meta={`${analysis.paymentRows} payments · ${analysis.payoutRows} payouts`} tone="green" symbol="⇵" /><KpiCard label="Gross payment volume" value={moneyExact(analysis.grossVolume, currency)} meta={`${analysis.uniqueOrders} unique orders`} tone="blue" symbol="↙" /><KpiCard label="Fees identified" value={moneyExact(analysis.paymentFees + analysis.payoutFees, currency)} meta={`${analysis.paidRows} paid · ${analysis.pendingRows} pending`} tone="orange" symbol="−" /><KpiCard label="Payout total" value={moneyExact(analysis.payoutTotal, currency)} meta={`Gap ${moneyExact(analysis.reconciliationDifference, currency)}`} tone="violet" symbol="↗" /></section><section className="import-analysis-grid"><div className="finance-card"><CardHeading eyebrow="Event mix" title="What the export contains" />{analysis.eventBreakdown.map((item) => <div className="import-breakdown-row" key={item.label}><div><strong>{item.label}</strong><small>{item.count} records</small></div><strong>{moneyExact(item.amount, currency)}</strong></div>)}</div><div className="finance-card"><CardHeading eyebrow="Settlement health" title="Status and monthly trend" />{analysis.statusBreakdown.map((item) => <div className="import-breakdown-row" key={item.label}><div><strong>{item.label}</strong><small>{item.count} records</small></div><strong>{moneyExact(item.amount, currency)}</strong></div>)}<div className="import-mini-trend">{analysis.monthlyTrend.map((item) => <div key={item.month}><span>{item.month}</span><i style={{ height: `${Math.max(8, Math.min(100, item.gross / Math.max(analysis.grossVolume, 1) * 100 * 4))}%` }} /><small>{moneyExact(item.net, currency)}</small></div>)}</div></div></section><section className="finance-card"><div className="import-table-heading"><div><span className="content-eyebrow">Detailed rows</span><h3>Payment transactions</h3><p>Showing the first {Math.min(paymentRows.length, 25)} of {analysis.paymentRows} rows. Full records remain available in the database.</p></div><div className="import-table-meta">{analysis.dateFrom ? `${dateLabel(analysis.dateFrom)} – ${dateLabel(analysis.dateTo)}` : 'No date range'}</div></div><div className="import-table"><div className="import-table-head"><span>Date</span><span>Event / order</span><span>Status</span><span>Gross</span><span>Fee</span><span>Net</span></div>{paymentRows.map((row) => <div className="import-table-row" key={row.source_key}><span>{dateLabel(row.transaction_date)}</span><span><strong>{row.event_type}</strong><small>{row.order_id || row.payment_method_name || 'Unlabelled payment'}</small></span><span className={`import-status ${row.payout_status || 'unknown'}`}>{row.payout_status || '—'}</span><strong>{moneyExact(row.amount, row.currency)}</strong><span>{moneyExact(row.fee, row.currency)}</span><strong className={number(row.net) < 0 ? 'negative' : 'positive'}>{moneyExact(row.net, row.currency)}</strong></div>)}{!paymentRows.length && <EmptyState title="No payment transactions yet" body="Import the payment transactions CSV to see detailed rows here." />}</div></section><section className="finance-card"><div className="import-table-heading"><div><span className="content-eyebrow">Settlement detail</span><h3>Payouts from PDF</h3><p>Bank references and settlement components are preserved for reconciliation.</p></div><div className="import-table-meta">{analysis.payoutRows} payouts</div></div><div className="import-table payout-table"><div className="import-table-head"><span>Date</span><span>Status / bank reference</span><span>Charges</span><span>Refunds</span><span>Fees</span><span>Total</span></div>{payoutRows.map((row) => <div className="import-table-row" key={row.source_key}><span>{dateLabel(row.payout_date)}</span><span><strong>{row.status}</strong><small>{row.bank_reference}</small></span><span>{moneyExact(row.charges, row.currency)}</span><span>{moneyExact(row.refunds, row.currency)}</span><span>{moneyExact(row.fees, row.currency)}</span><strong>{moneyExact(row.total, row.currency)}</strong></div>)}{!payoutRows.length && <EmptyState title="No payouts yet" body="Import the payout PDF to see settlement rows here." />}</div></section></>}{importedData.batches.length > 0 && <section className="finance-card"><CardHeading eyebrow="Import history" title="Source files" />{importedData.batches.map((batch) => <div className="import-history-row" key={batch.id}><span className="file-type-pill">{batch.file_type.toUpperCase()}</span><div><strong>{batch.file_name}</strong><small>{batch.source_kind === 'payment_transactions' ? 'Payment transactions' : 'Payout settlements'} · {dateLabel(batch.imported_at.slice(0, 10))}</small></div><span>{batch.imported_count} imported{batch.duplicate_count ? ` · ${batch.duplicate_count} skipped` : ''}</span></div>)}</section>}</div>;
}

function CalendarView({ data }: { data: FinanceData }) { const events = [...data.recurring.map((item) => ({ id: item.id, title: item.name, date: item.next_due_date, amount: item.amount, type: item.payment_type })), ...data.goals.filter((item) => item.target_date).map((item) => ({ id: item.id, title: `${item.name} target date`, date: item.target_date as string, amount: item.target_amount, type: 'goal' }))].sort((a, b) => a.date.localeCompare(b.date)); return <div className="view-stack"><section className="module-header"><div><span className="content-eyebrow">Dates that deserve less mental space</span><h2>Financial calendar</h2><p>Bills, goals, and commitments, in one calm sequence.</p></div><div className="month-selector">August 2026 ⌄</div></section><section className="calendar-layout"><div className="calendar-month"><div className="calendar-head"><button>‹</button><strong>August 2026</strong><button>›</button></div><div className="calendar-week">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div><div className="calendar-days">{Array.from({ length: 31 }, (_, index) => <span className={index + 1 === today.getDate() ? 'today' : [4, 7, 11, 22].includes(index + 1) ? 'has-event' : ''} key={index}>{index + 1}</span>)}</div></div><div className="calendar-events"><CardHeading eyebrow="Upcoming" title="What’s next" />{events.map((event) => <div className="calendar-event" key={event.id}><span className="event-date">{new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(new Date(`${event.date}T00:00:00`))}</span><div><strong>{event.title}</strong><small>{event.type} · {money(event.amount)}</small></div><span>↗</span></div>)}{!events.length && <EmptyState title="Your calendar is clear" body="Add recurring payments or savings goals to see upcoming dates." />}</div></section></div>; }

function NotificationPanel({ notifications, onClose }: { notifications: FinanceNotification[]; onClose: () => void }) { return <div className="notification-panel"><div className="notification-head"><strong>Notifications</strong><button onClick={onClose}>×</button></div>{notifications.map((notification) => <div className="notification-item" key={notification.id}><span className={`notification-icon ${notification.kind}`}>{notification.kind === 'warning' ? '!' : notification.kind === 'reminder' ? '◷' : '✓'}</span><div><strong>{notification.title}</strong><p>{notification.body}</p></div></div>)}{!notifications.length && <div className="notification-empty">You’re all caught up.</div>}</div>; }

function AssistantPanel({ question, setQuestion, answer, onAsk, onClose }: { question: string; setQuestion: (value: string) => void; answer: string; onAsk: () => void; onClose: () => void }) { return <aside className="assistant-panel"><div className="assistant-head"><div><span className="assistant-spark">✦</span><div><strong>Finance assistant</strong><small>Private to your workspace</small></div></div><button onClick={onClose}>×</button></div><div className="assistant-intro"><p>Ask a plain-language question. I’ll use the numbers in your workspace to help you find the next useful move.</p><div className="suggestion-row"><button onClick={() => setQuestion('Where did I spend the most?')}>Top spend</button><button onClick={() => setQuestion('How long will it take to reach my goal?')}>Goal runway</button></div></div><div className="assistant-answer"><span>✦</span><p>{answer}</p></div><div className="assistant-input"><input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onAsk(); }} placeholder="Ask about your money…" /><button onClick={onAsk}>↗</button></div></aside>; }

function TransactionModal({ form, setForm, accounts, categories, onSubmit, onClose }: { form: TransactionForm; setForm: (form: TransactionForm) => void; accounts: FinanceAccount[]; categories: FinanceCategory[]; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) { return <div className="modal-backdrop" onClick={onClose}><div className="finance-modal wide" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="content-eyebrow">New record</span><h2>Add transaction</h2><p>Every small detail makes your future reports more useful.</p></div><button onClick={onClose}>×</button></div><form className="modal-form" onSubmit={onSubmit}><div className="type-toggle">{(['expense', 'income', 'transfer'] as const).map((type) => <button type="button" className={form.type === type ? 'selected' : ''} key={type} onClick={() => setForm({ ...form, type })}>{type[0].toUpperCase() + type.slice(1)}</button>)}</div><div className="form-grid"><Field label="Amount" name="amount" type="number" value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} placeholder="0.00" required /><Field label="Date" name="date" type="date" value={form.transactionDate} onChange={(value) => setForm({ ...form, transactionDate: value })} required /></div><div className="form-grid"><SelectField label="Account" name="account" value={form.accountId} onChange={(value) => setForm({ ...form, accountId: value })} options={accounts.map((account) => account.id)} labels={accounts.map((account) => account.name)} required /><SelectField label={form.type === 'transfer' ? 'To account' : 'Category'} name="category" value={form.type === 'transfer' ? form.transferAccountId : form.categoryId} onChange={(value) => setForm(form.type === 'transfer' ? { ...form, transferAccountId: value } : { ...form, categoryId: value })} options={(form.type === 'transfer' ? accounts : categories.filter((category) => category.kind !== 'income')).map((item) => item.id)} labels={(form.type === 'transfer' ? accounts : categories.filter((category) => category.kind !== 'income')).map((item) => item.name)} /></div><div className="form-grid"><Field label="Merchant" name="merchant" value={form.merchant} onChange={(value) => setForm({ ...form, merchant: value })} placeholder="e.g. Swiggy" /><Field label="Tags" name="tags" value={form.tags} onChange={(value) => setForm({ ...form, tags: value })} placeholder="work, travel" /></div><Field label="Description" name="description" value={form.description} onChange={(value) => setForm({ ...form, description: value })} placeholder="Optional note for future you" /><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Save transaction ↗</button></div></form></div></div>; }

function SimpleModal({ title, description, onSubmit, onClose, submitLabel, children }: { title: string; description: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void; submitLabel: string; children: ReactNode }) { return <div className="modal-backdrop" onClick={onClose}><div className="finance-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="content-eyebrow">New plan</span><h2>{title}</h2><p>{description}</p></div><button onClick={onClose}>×</button></div><form className="modal-form" onSubmit={onSubmit}>{children}<div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">{submitLabel} ↗</button></div></form></div></div>; }
function Field({ label, name, type = 'text', placeholder, required, value, onChange }: { label: string; name: string; type?: string; placeholder?: string; required?: boolean; value?: string; onChange?: (value: string) => void }) { return <label className="modal-field"><span>{label}</span><input name={name} type={type} placeholder={placeholder} required={required} value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined} /></label>; }
function SelectField({ label, name, options, labels, value, onChange, required }: { label: string; name: string; options: string[]; labels?: string[]; value?: string; onChange?: (value: string) => void; required?: boolean }) { return <label className="modal-field"><span>{label}</span><select name={name} required={required} value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined}><option value="">Choose {label.toLowerCase()}</option>{options.map((option, index) => <option key={option} value={option}>{labels?.[index] || option.replace('_', ' ')}</option>)}</select></label>; }
function ConfirmDialog({ title, body, onCancel, onConfirm }: { title: string; body: string; onCancel: () => void; onConfirm: () => void }) { return <div className="modal-backdrop"><div className="confirm-dialog"><div className="confirm-icon">!</div><h2>{title}</h2><p>{body}</p><div className="modal-actions"><button className="secondary-button" onClick={onCancel}>Keep it</button><button className="danger-button" onClick={onConfirm}>Delete</button></div></div></div>; }
