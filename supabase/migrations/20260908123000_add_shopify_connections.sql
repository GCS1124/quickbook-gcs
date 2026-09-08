-- Store each GCS Books user's Shopify connection separately. The access token
-- is encrypted by the production API before it reaches this table; RLS keeps
-- the ciphertext scoped to the signed-in owner.

create table if not exists public.finance_shopify_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  store_domain text not null check (store_domain ~ '^[a-z0-9][a-z0-9-]*[.]myshopify[.]com$'),
  access_token_ciphertext text not null,
  scope text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.finance_shopify_connections enable row level security;

revoke all on public.finance_shopify_connections from anon;
grant select, insert, update, delete on public.finance_shopify_connections to authenticated;

drop policy if exists "shopify connections owner access" on public.finance_shopify_connections;
create policy "shopify connections owner access"
  on public.finance_shopify_connections
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
