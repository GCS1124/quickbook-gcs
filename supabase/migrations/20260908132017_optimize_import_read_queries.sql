-- Keep the import center fast for large Shopify product exports.
-- The page filters every query by user_id and sorts products by product_title.
-- This composite index lets Postgres satisfy both operations without scanning
-- and sorting the entire user's product history.
create index if not exists finance_shopify_products_user_title_idx
  on public.finance_shopify_products (user_id, product_title asc);
