-- ROTA 95 — pedidos sequenciais, rastreio e sincronização da conta
-- Execute uma única vez no Supabase SQL Editor, depois dos scripts anteriores.

alter table public.orders add column if not exists order_number bigint;
alter table public.orders add column if not exists display_id text;

drop index if exists public.orders_order_number_unique_idx;

create index if not exists orders_order_number_idx
  on public.orders (order_number)
  where order_number is not null;

create unique index if not exists orders_display_id_unique_idx
  on public.orders (display_id)
  where display_id is not null;

create table if not exists public.order_counters (
  counter_year integer primary key,
  last_value bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.order_counters enable row level security;
revoke all on public.order_counters from anon, authenticated;
grant select, insert, update, delete on public.order_counters to service_role;

create or replace function public.assign_rota95_order_number(p_order_id uuid)
returns table(public_id text, sequence_number bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
  v_existing_number bigint;
  v_year integer;
  v_next bigint;
begin
  select o.display_id, o.order_number,
         extract(year from coalesce(o.paid_at, o.created_at, now()))::integer
    into v_existing, v_existing_number, v_year
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido não encontrado.';
  end if;

  if v_existing is not null then
    return query select v_existing, v_existing_number;
    return;
  end if;

  insert into public.order_counters(counter_year, last_value, updated_at)
  values (v_year, 1, now())
  on conflict (counter_year)
  do update set
    last_value = public.order_counters.last_value + 1,
    updated_at = now()
  returning last_value into v_next;

  v_existing := format('#ROTA95_%s_%s', v_year, v_next);

  update public.orders
  set order_number = v_next,
      display_id = v_existing,
      updated_at = now()
  where id = p_order_id;

  return query select v_existing, v_next;
end;
$$;

revoke all on function public.assign_rota95_order_number(uuid) from public, anon, authenticated;
grant execute on function public.assign_rota95_order_number(uuid) to service_role;

-- Garante leitura dos próprios pedidos, itens e histórico pelo cliente autenticado.
grant select on public.orders, public.order_items, public.order_history, public.profiles to authenticated;
grant insert, update on public.profiles to authenticated;

-- Numera os pedidos pagos anteriores em ordem cronológica.
do $$
declare
  rec record;
begin
  for rec in
    select o.id
    from public.orders o
    where o.display_id is null
      and (
        o.paid_at is not null
        or upper(coalesce(o.status, '')) in ('CONFIRMED','RECEIVED','PAID')
        or upper(coalesce(o.fulfillment_status, '')) in (
          'PAID_AWAITING_PROCESSING','PREPARING','READY_TO_SHIP',
          'READY_FOR_PICKUP','SHIPPED','DELIVERED'
        )
      )
    order by coalesce(o.paid_at, o.created_at), o.created_at, o.id
  loop
    perform public.assign_rota95_order_number(rec.id);
  end loop;
end $$;
