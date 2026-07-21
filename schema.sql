create extension if not exists pgcrypto;

create table if not exists public.store_state (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  cpf_cnpj text,
  postal_code text,
  state text,
  city text,
  province text,
  address text,
  address_number text,
  complement text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  external_id text unique,
  payment_id text,
  status text not null default 'PENDING',
  total numeric(12,2) not null default 0,
  payment_method text,
  customer jsonb not null default '{}'::jsonb,
  delivery jsonb not null default '{}'::jsonb,
  tracking_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id text not null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0)
);

create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

alter table public.store_state enable row level security;
alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.favorites enable row level security;

-- Catálogo/configuração podem ser lidos publicamente.
drop policy if exists "public read store state" on public.store_state;
create policy "public read store state" on public.store_state for select using (true);

-- Escrita administrativa deve ser feita por função/backend com service role.
-- Não crie política pública de insert/update para store_state em produção.

create policy "users read own profile" on public.profiles for select using (auth.uid() = id);
create policy "users insert own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "users update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "users read own orders" on public.orders for select using (auth.uid() = user_id);
create policy "users create own orders" on public.orders for insert with check (auth.uid() = user_id);

create policy "users read own order items" on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
);

create policy "users manage own favorites" on public.favorites for all
using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
