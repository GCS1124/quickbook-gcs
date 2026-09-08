import type { SupabaseClient } from '@supabase/supabase-js';

export type FinanceRealtimeStatus = 'connecting' | 'connected' | 'reconnecting' | 'error' | 'offline';
export type FinanceRealtimeStatusChange = { status: FinanceRealtimeStatus; message?: string };
export type FinanceRealtimeChange = { table: string; event: 'INSERT' | 'UPDATE' | 'DELETE' | '*'; };

// Every table read by the finance workspace is included so a change made in
// another tab, an import worker, or the Supabase dashboard refreshes every
// dependent view through the existing data loader.
export const FINANCE_REALTIME_TABLES = [
  'finance_profiles',
  'finance_accounts',
  'finance_categories',
  'finance_tags',
  'finance_transaction_tags',
  'finance_transactions',
  'finance_budgets',
  'finance_goals',
  'finance_recurring_payments',
  'finance_investments',
  'finance_loans',
  'finance_splits',
  'finance_calendar_events',
  'finance_notifications',
  'finance_import_batches',
  'finance_payment_imports',
  'finance_payouts',
  'finance_shopify_orders',
  'finance_shopify_products',
  'finance_operating_expenses',
] as const;

type RealtimeStatusCallback = (change: FinanceRealtimeStatusChange) => void;
type RealtimeChangeCallback = (change: FinanceRealtimeChange) => void;

const errorMessage = (error: unknown) => error instanceof Error && error.message ? error.message : '';

/**
 * Opens one authenticated channel for the current user and listens to all
 * finance tables. The caller owns the returned cleanup function.
 */
export function connectFinanceRealtime(
  client: SupabaseClient,
  userId: string,
  onStatus: RealtimeStatusCallback,
  onChange: RealtimeChangeCallback,
) {
  let active = true;
  const channel = client.channel(`finance-live:${userId}`, {
    config: {
      // Do not report success until Postgres replication has accepted every
      // binding. This makes a missing publication visible instead of looking
      // connected while silently dropping database changes.
      postgres_changes_options: { wait: true, timeout: 20_000 },
    },
  });

  FINANCE_REALTIME_TABLES.forEach((table) => {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` },
      (payload) => {
        if (!active) return;
        const event = String(payload.eventType || '*').toUpperCase();
        onChange({
          table,
          event: event === 'INSERT' || event === 'UPDATE' || event === 'DELETE' ? event : '*',
        });
      },
    );
  });

  onStatus({ status: 'connecting' });
  channel.subscribe((status, error) => {
    if (!active) return;
    if (status === 'SUBSCRIBED') {
      onStatus({ status: 'connected' });
    } else if (status === 'TIMED_OUT') {
      onStatus({ status: 'reconnecting', message: 'Realtime is taking longer than expected and will retry automatically.' });
    } else if (status === 'CHANNEL_ERROR') {
      onStatus({ status: 'error', message: errorMessage(error) || 'Supabase rejected the realtime channel. Check the table publication and RLS policies.' });
    } else if (status === 'CLOSED') {
      onStatus({ status: 'offline', message: 'The realtime channel is closed. Changes will still load on the next refresh.' });
    }
  });

  return () => {
    active = false;
    void client.removeChannel(channel);
  };
}
