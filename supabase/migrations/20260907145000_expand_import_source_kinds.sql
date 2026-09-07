-- Keep the import batch constraint aligned with every Shopify P&L source
-- accepted by the application.
alter table public.finance_import_batches
  drop constraint if exists finance_import_batches_source_kind_check;

alter table public.finance_import_batches
  add constraint finance_import_batches_source_kind_check
  check (source_kind in (
    'payment_transactions',
    'shopify_payment_transactions',
    'shopify_orders',
    'shopify_products',
    'operating_expenses',
    'payouts'
  ));
