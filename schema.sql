-- OPG BUSINESS CONTROL: выполните целиком в Supabase -> SQL Editor

create table public.businesses (
  id int primary key check (id between 1 and 76),
  name text not null,
  owner text check (owner in ('orekhovskaya','tambovskaya','kurganskaya','kavkazskaya')), -- null = свободен
  updated_at timestamptz not null default now()
);

create table public.history (
  id bigint generated always as identity primary key,
  business_id int not null,
  business_name text not null,
  from_owner text,
  to_owner text,
  changed_by text not null,
  changed_at timestamptz not null default now()
);

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null
);

insert into public.businesses (id, name) values
  (1, 'Магазин 24/7'),
  (2, 'Магазин 24/7'),
  (3, 'Магазин 24/7'),
  (4, 'Магазин 24/7'),
  (5, 'Магазин 24/7'),
  (6, 'Магазин 24/7'),
  (7, 'Магазин 24/7'),
  (8, 'Магазин 24/7'),
  (9, 'Магазин 24/7'),
  (10, 'Магазин одежды'),
  (11, 'Магазин одежды'),
  (12, 'Магазин одежды'),
  (13, 'Магазин одежды'),
  (14, 'Магазин одежды'),
  (15, 'Ресторан'),
  (16, 'Ресторан'),
  (17, 'Ресторан'),
  (18, 'Ресторан'),
  (19, 'Ресторан'),
  (20, 'Ресторан'),
  (21, 'Ресторан'),
  (22, 'Ресторан'),
  (23, 'Ресторан'),
  (24, 'Магазин оружия'),
  (25, 'АЗС Южный'),
  (26, 'АЗС Ашан'),
  (27, 'Стоянка Арзамас'),
  (28, 'Стоянка пгт. Батырево'),
  (29, 'Стоянка г. Южный'),
  (30, 'АЗС Арзамас'),
  (31, 'АЗС Арзамас 2'),
  (32, 'АЗС Батырево-Арзамас'),
  (33, 'АЗС Батырево'),
  (34, 'АЗС Лыткарино'),
  (35, 'Магазин оружия'),
  (36, 'АЗС Бусаево'),
  (37, 'Магазин 24/7'),
  (38, 'Ресторан'),
  (39, 'ГрузоКоннект'),
  (40, 'ВекторГруз'),
  (41, 'ТрансГрузЛиз'),
  (42, 'Магазин одежды'),
  (43, 'Магазин 24/7'),
  (44, 'Магазин 24/7'),
  (45, 'АЗС Батырево-Арзамас 2'),
  (46, 'АЗС Эдово-2'),
  (47, 'АЗС Эдово-1'),
  (48, 'Стоянка г. Эдово'),
  (49, 'Магазин 24/7'),
  (50, 'АЗС Лыткарино-2'),
  (51, 'Постомат #1'),
  (52, 'Постомат #2'),
  (53, 'Постомат #3'),
  (54, 'Постомат #4'),
  (55, 'Постомат #5'),
  (56, 'Постомат #6'),
  (57, 'Постомат #7'),
  (58, 'Постомат #8'),
  (59, 'Постомат #9'),
  (60, 'Постомат #10'),
  (61, 'Нотариус г. Арзамас'),
  (62, 'Нотариус г. Южный'),
  (63, 'Постомат #11'),
  (64, 'Магазин кирок Арзамас'),
  (65, 'Магазин кирок Батырево'),
  (66, 'Магазин кирок Южный'),
  (67, 'Магазин 24/7'),
  (68, 'Ресторан'),
  (69, 'Магазин 24/7'),
  (70, 'Магазин 24/7'),
  (71, 'Ресторан'),
  (72, 'АЗС Рыбацкое'),
  (73, 'Магазин 24/7'),
  (74, 'АЗС Дамба-1'),
  (75, 'Магазин 24/7'),
  (76, 'Магазин одежды');

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;

-- история пишется самой базой: подделать её с сайта нельзя
create function public.log_change() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.owner is distinct from old.owner then
    new.updated_at := now();
    insert into public.history (business_id, business_name, from_owner, to_owner, changed_by)
    values (old.id, old.name, old.owner, new.owner,
      coalesce((select name from public.admins where user_id = auth.uid()), 'система'));
  end if;
  return new;
end
$$;

create trigger businesses_log before update on public.businesses
  for each row execute function public.log_change();

create function public.reset_all() returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Только для администратора'; end if;
  update public.businesses set owner = null where owner is not null;
end
$$;
revoke execute on function public.reset_all() from public, anon;

-- защита: читать может любой, менять только админ; таблица admins закрыта от API
alter table public.businesses enable row level security;
alter table public.history enable row level security;
alter table public.admins enable row level security;

create policy "view businesses" on public.businesses for select using (true);
create policy "admin edits businesses" on public.businesses for update
  using (public.is_admin()) with check (public.is_admin());
create policy "view history" on public.history for select using (true);

-- синхронизация в реальном времени
alter publication supabase_realtime add table public.businesses, public.history;
