-- Run once in Supabase SQL Editor. All rows are fictional coursework records.
create extension if not exists pgcrypto;
create table if not exists employees (
  id uuid primary key default gen_random_uuid(), name text unique not null, role text not null check (role in ('manager','salesperson','expense_reporter')),
  telegram_user_id text unique, linked_telegram_chat_id text
);
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(), reference text unique not null, kind text not null check (kind in ('sale','expense')),
  submitter_id uuid references employees(id), submitter_name text, submitter_role text, source text not null check(source in ('website','telegram')),
  originating_chat_id text, customer text, project text check(project in ('A','B')), description text not null, amount numeric(12,2) not null check(amount>0),
  expense_category text check(expense_category in ('Materials','Travel','Other')), proposed_allocation text check(proposed_allocation in ('A','B','company_overhead')),
  final_allocation text check(final_allocation in ('A','B','company_overhead')), status text not null,
  manager_id uuid references employees(id), manager_decided_at timestamptz, sheet_sync_status text default 'pending', sheet_sync_error text,
  notification_status text default 'not_applicable', notification_error text, created_at timestamptz not null default now()
);
create table if not exists commission_splits (
  id uuid primary key default gen_random_uuid(), transaction_id uuid not null references transactions(id) on delete cascade,
  employee_id uuid not null references employees(id), proposed_percent numeric(5,2) not null check(proposed_percent between 0 and 100),
  final_percent numeric(5,2), earned_amount numeric(12,2), unique(transaction_id,employee_id)
);
insert into employees(name,role) values
 ('Svetlana de Monte Carlo','manager'),('Richard Darling','salesperson'),('Anastasia Ferrari','salesperson'),('Jean-Claude Bērziņš','salesperson'),('Kevin von Whatever','expense_reporter') on conflict(name) do nothing;
-- Compatibility for the early classroom database, where sheet_sync_status
-- was created with the delivery_status enum instead of text.
do $$
begin
  if exists (select 1 from pg_type where typname = 'delivery_status') then
    alter type delivery_status add value if not exists 'synced';
  end if;
end $$;
