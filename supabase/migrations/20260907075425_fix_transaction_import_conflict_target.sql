-- The importer uses upsert(..., { onConflict: 'user_id,external_source_key' }).
-- A partial unique index cannot be inferred by PostgREST for that conflict target.
-- Keep PostgreSQL's normal NULL semantics while enforcing uniqueness for imported keys.
drop index if exists public.finance_transactions_import_key_idx;

alter table public.finance_transactions
  add constraint finance_transactions_user_external_source_key
  unique (user_id, external_source_key);
