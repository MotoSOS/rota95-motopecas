-- ROTA 95 — checkout dentro do site e gestão completa de pedidos
-- Execute no Supabase SQL Editor depois do schema principal.

alter table public.orders add column if not exists fulfillment_status text not null default 'AWAITING_PAYMENT';
alter table public.orders add column if not exists payment_data jsonb not null default '{}'::jsonb;
alter table public.orders add column if not exists carrier text;
alter table public.orders add column if not exists tracking_url text;
alter table public.orders add column if not exists admin_notes text;
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists shipped_at timestamptz;
alter table public.orders add column if not exists delivered_at timestamptz;
alter table public.orders add column if not exists cancelled_at timestamptz;

create index if not exists orders_fulfillment_status_idx on public.orders (fulfillment_status);
create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_tracking_code_idx on public.orders (tracking_code);

create table if not exists public.order_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  event text not null,
  status text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

alter table public.order_history enable row level security;

-- O cliente autenticado pode consultar o histórico dos próprios pedidos.
drop policy if exists "users read own order history" on public.order_history;
create policy "users read own order history" on public.order_history
for select using (
  exists (
    select 1 from public.orders o
    where o.id = order_id and o.user_id = auth.uid()
  )
);

-- A conta administrativa também pode ler pedidos e histórico pelo cliente Supabase,
-- embora o painel use principalmente a API protegida da Vercel.
drop policy if exists "admin read all orders" on public.orders;
create policy "admin read all orders" on public.orders
for select using ((auth.jwt() ->> 'email') = 'motopecas.rota95@gmail.com');

drop policy if exists "admin update all orders" on public.orders;
create policy "admin update all orders" on public.orders
for update using ((auth.jwt() ->> 'email') = 'motopecas.rota95@gmail.com')
with check ((auth.jwt() ->> 'email') = 'motopecas.rota95@gmail.com');

drop policy if exists "admin read all order items" on public.order_items;
create policy "admin read all order items" on public.order_items
for select using ((auth.jwt() ->> 'email') = 'motopecas.rota95@gmail.com');

drop policy if exists "admin read all order history" on public.order_history;
create policy "admin read all order history" on public.order_history
for select using ((auth.jwt() ->> 'email') = 'motopecas.rota95@gmail.com');

grant select, insert, update, delete on public.order_history to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Ajusta pedidos antigos para um estado operacional coerente.
update public.orders
set fulfillment_status = case
  when upper(coalesce(status,'')) in ('CONFIRMED','RECEIVED','PAID') then 'PAID_AWAITING_PROCESSING'
  when upper(coalesce(status,'')) in ('OVERDUE','REFUNDED','DELETED') then upper(status)
  when upper(coalesce(status,'')) = 'PAYMENT_ERROR' then 'PAYMENT_ERROR'
  else coalesce(nullif(fulfillment_status,''), 'AWAITING_PAYMENT')
end
where fulfillment_status is null
   or fulfillment_status = ''
   or fulfillment_status = 'AWAITING_PAYMENT';
