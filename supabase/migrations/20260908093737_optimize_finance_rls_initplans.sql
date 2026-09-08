-- Evaluate auth.uid() once per statement instead of once per row.
-- The predicates remain identical and continue to scope every row to its owner.

drop policy if exists finance_import_batches_owner on public.finance_import_batches;
create policy finance_import_batches_owner
  on public.finance_import_batches
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists finance_payment_imports_owner on public.finance_payment_imports;
create policy finance_payment_imports_owner
  on public.finance_payment_imports
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists finance_payouts_owner on public.finance_payouts;
create policy finance_payouts_owner
  on public.finance_payouts
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
