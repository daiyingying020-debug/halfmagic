-- Run in the Supabase SQL editor. Supabase Auth owns user identities.
create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text not null default '',
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'usd',
  category text not null default 'other',
  image_url text,
  stock integer not null default 0 check (stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending_payment' check (status in ('pending_payment','paid','cancelled','payment_failed','refunded')),
  total_cents integer not null default 0 check (total_cents >= 0),
  currency text not null default 'usd',
  stripe_session_id text unique,
  stripe_payment_intent_id text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity between 1 and 10),
  unit_price_cents integer not null check (unit_price_cents >= 0)
);

create index if not exists orders_user_created_idx on public.orders(user_id, created_at desc);
create index if not exists order_items_order_idx on public.order_items(order_id);

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy "Active products are publicly readable" on public.products
  for select using (active = true);
create policy "Users read their own orders" on public.orders
  for select to authenticated using (auth.uid() = user_id);
create policy "Users read their own order items" on public.order_items
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  );

-- Atomically lock product rows, validate stock, snapshot prices and reserve inventory.
create or replace function public.reserve_inventory_for_order(p_user_id uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty integer;
  v_total integer := 0;
begin
  if p_user_id is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Invalid order payload';
  end if;

  insert into public.orders(user_id, status) values (p_user_id, 'pending_payment')
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty < 1 or v_qty > 10 then raise exception 'Invalid quantity'; end if;

    select * into v_product from public.products
      where id = (v_item->>'product_id')::uuid and active = true
      for update;
    if not found or v_product.stock < v_qty then raise exception 'Insufficient stock or inactive product'; end if;

    update public.products set stock = stock - v_qty, updated_at = now() where id = v_product.id;
    insert into public.order_items(order_id, product_id, quantity, unit_price_cents)
      values (v_order_id, v_product.id, v_qty, v_product.price_cents);
    v_total := v_total + (v_product.price_cents * v_qty);
  end loop;

  update public.orders set total_cents = v_total where id = v_order_id;
  return v_order_id;
exception when others then
  raise;
end;
$$;

create or replace function public.complete_paid_order(p_order_id uuid, p_stripe_session_id text, p_payment_intent_id text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.orders
    set status = 'paid', stripe_session_id = p_stripe_session_id,
        stripe_payment_intent_id = p_payment_intent_id, paid_at = coalesce(paid_at, now())
    where id = p_order_id and status = 'pending_payment';
  -- Repeated webhook deliveries are safe: paid orders remain unchanged.
end;
$$;

create or replace function public.release_order_reservation(p_order_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_item record;
begin
  if not exists (select 1 from public.orders where id = p_order_id and status = 'pending_payment' for update) then
    return;
  end if;
  for v_item in select product_id, quantity from public.order_items where order_id = p_order_id loop
    update public.products set stock = stock + v_item.quantity, updated_at = now()
      where id = v_item.product_id;
  end loop;
  update public.orders set status = 'cancelled' where id = p_order_id;
end;
$$;

revoke all on function public.reserve_inventory_for_order(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.complete_paid_order(uuid,text,text) from public, anon, authenticated;
revoke all on function public.release_order_reservation(uuid) from public, anon, authenticated;
grant execute on function public.reserve_inventory_for_order(uuid,jsonb) to service_role;
grant execute on function public.complete_paid_order(uuid,text,text) to service_role;
grant execute on function public.release_order_reservation(uuid) to service_role;
