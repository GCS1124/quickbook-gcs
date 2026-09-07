-- Persist the source datasets needed to calculate a Shopify accrual P&L.
-- Orders provide sales, discounts, returns, shipping, and taxes; products
-- provide cost per item for COGS; operating expenses cover costs Shopify does
-- not include in the order export.

alter table public.finance_profiles
  alter column default_currency set default 'USD';

alter table public.finance_accounts
  alter column currency_code set default 'USD';

alter table public.finance_transactions
  alter column currency_code set default 'USD';

alter table public.finance_budgets
  alter column currency_code set default 'USD';

alter table public.finance_goals
  alter column currency_code set default 'USD';

alter table public.finance_recurring_payments
  alter column currency_code set default 'USD';

alter table public.finance_investments
  alter column currency_code set default 'USD';

alter table public.finance_loans
  alter column currency_code set default 'USD';

create table if not exists public.finance_shopify_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null references public.finance_import_batches(id) on delete cascade,
  source_key text not null,
  order_name text not null,
  order_date date not null,
  financial_status text not null default '',
  currency_code text not null default 'USD' check (char_length(currency_code) = 3),
  gross_sales numeric(18,2) not null default 0,
  discounts_amount numeric(18,2) not null default 0,
  returns_amount numeric(18,2) not null default 0,
  shipping_amount numeric(18,2) not null default 0,
  taxes_amount numeric(18,2) not null default 0,
  total_sales numeric(18,2) not null default 0,
  item_quantity integer not null default 0 check (item_quantity >= 0),
  line_items jsonb not null default '[]'::jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, source_key)
);

create table if not exists public.finance_shopify_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null references public.finance_import_batches(id) on delete cascade,
  source_key text not null,
  sku text,
  product_title text not null default '',
  cost_per_item numeric(18,2) not null default 0 check (cost_per_item >= 0),
  inventory_quantity numeric(18,3),
  currency_code text not null default 'USD' check (char_length(currency_code) = 3),
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, source_key)
);

create table if not exists public.finance_operating_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null references public.finance_import_batches(id) on delete cascade,
  source_key text not null,
  expense_date date not null,
  category text not null default 'Other',
  description text not null default '',
  amount numeric(18,2) not null check (amount > 0),
  currency_code text not null default 'USD' check (char_length(currency_code) = 3),
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, source_key)
);

create index if not exists finance_shopify_orders_user_date_idx
  on public.finance_shopify_orders (user_id, order_date desc);
create index if not exists finance_shopify_orders_batch_idx
  on public.finance_shopify_orders (user_id, batch_id);
create index if not exists finance_shopify_orders_batch_fk_idx
  on public.finance_shopify_orders (batch_id);
create index if not exists finance_shopify_products_user_sku_idx
  on public.finance_shopify_products (user_id, sku);
create index if not exists finance_shopify_products_batch_idx
  on public.finance_shopify_products (user_id, batch_id);
create index if not exists finance_shopify_products_batch_fk_idx
  on public.finance_shopify_products (batch_id);
create index if not exists finance_operating_expenses_user_date_idx
  on public.finance_operating_expenses (user_id, expense_date desc);
create index if not exists finance_operating_expenses_batch_idx
  on public.finance_operating_expenses (user_id, batch_id);
create index if not exists finance_operating_expenses_batch_fk_idx
  on public.finance_operating_expenses (batch_id);

alter table public.finance_shopify_orders enable row level security;
alter table public.finance_shopify_products enable row level security;
alter table public.finance_operating_expenses enable row level security;

revoke all on public.finance_shopify_orders from anon;
revoke all on public.finance_shopify_products from anon;
revoke all on public.finance_operating_expenses from anon;
grant select, insert, update, delete on public.finance_shopify_orders to authenticated;
grant select, insert, update, delete on public.finance_shopify_products to authenticated;
grant select, insert, update, delete on public.finance_operating_expenses to authenticated;

drop policy if exists "shopify orders owner access" on public.finance_shopify_orders;
create policy "shopify orders owner access"
  on public.finance_shopify_orders
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "shopify products owner access" on public.finance_shopify_products;
create policy "shopify products owner access"
  on public.finance_shopify_products
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "operating expenses owner access" on public.finance_operating_expenses;
create policy "operating expenses owner access"
  on public.finance_operating_expenses
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
