-- Branch outlet per supermarket chain (Palace-style multi-branch retailers)

alter table public.supermarkets
  add column if not exists branch text,
  add column if not exists store_code text;

comment on column public.supermarkets.branch is 'Outlet/branch name (e.g. ADENTA) when the retailer has multiple locations';
comment on column public.supermarkets.store_code is 'Retailer store code from imported sales spreadsheets (e.g. 1050)';

create unique index if not exists idx_supermarkets_name_branch_active
  on public.supermarkets (lower(name), lower(coalesce(branch, '')))
  where deleted_at is null;
