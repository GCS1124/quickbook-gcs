alter table public.finance_import_batches
  add column if not exists review_count integer not null default 0;

alter table public.finance_import_batches
  drop constraint if exists finance_import_batches_review_count_check;

alter table public.finance_import_batches
  add constraint finance_import_batches_review_count_check check (review_count >= 0);

alter table public.finance_import_batches
  drop constraint if exists finance_import_batches_source_kind_check;

alter table public.finance_import_batches
  add constraint finance_import_batches_source_kind_check
  check (source_kind in ('payment_transactions', 'shopify_payment_transactions', 'payouts'));

create unique index if not exists finance_payment_imports_user_id_source_key_key
  on public.finance_payment_imports (user_id, source_key);
