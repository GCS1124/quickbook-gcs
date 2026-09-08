-- Enable Realtime for every user-scoped table rendered by the finance app.
-- RLS policies continue to decide which rows each authenticated user can see.
do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array[
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
      'finance_operating_expenses'
    ] loop
      if to_regclass(format('public.%I', table_name)) is not null
        and not exists (
          select 1
          from pg_publication_tables
          where pubname = 'supabase_realtime'
            and schemaname = 'public'
            and tablename = table_name
        ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end
$$;
