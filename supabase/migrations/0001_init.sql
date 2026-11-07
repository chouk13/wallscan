-- WallScan — schéma v1 (docs/PROMPT-MAITRE.md §3)
-- Règles : soft-delete sur toute donnée client ; RLS par org_id ; prix et taux historisés (jamais écrasés) ;
-- devis envoyé immuable (nouvelle version) ; montants en centimes (bigint) ; taux en points de base (int).
-- Rollback : voir 0001_init.down.sql

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- organisations & utilisateurs
create table organizations (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  country              char(2) not null default 'CH',
  locale_default       text not null default 'fr' check (locale_default in ('fr','de','it','en')),
  vat_number           text,
  crm_provider         text not null default 'internal' check (crm_provider in ('internal','octyzen','bexio','hubspot','webhook')),
  crm_config_encrypted bytea,                       -- chiffré applicatif (CRM_CONFIG_ENCRYPTION_KEY)
  quote_settings       jsonb not null default '{}'::jsonb,  -- marges de coupe, règle ouvertures, arrondi… À CONFIRMER
  created_at           timestamptz not null default now()
);

create table users (
  id                 uuid primary key references auth.users(id) on delete cascade,
  org_id             uuid not null references organizations(id),
  role               text not null check (role in ('admin','seller','client')),
  email              text not null,
  locale             text not null default 'fr' check (locale in ('fr','de','it','en')),
  discount_limit_pct int  not null default 0 check (discount_limit_pct between 0 and 100),
  created_at         timestamptz not null default now()
);
create index on users(org_id);

-- ---------------------------------------------------------------- catalogue
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  lead_time_days int
);
create table collections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  supplier_id uuid references suppliers(id),
  name text not null, year int, active boolean not null default true
);
create table wallpapers (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id),
  collection_id         uuid references collections(id),
  sku                   text not null,
  name                  text not null,
  color_name            text,
  roll_width_cm         numeric(6,2) not null check (roll_width_cm > 0),
  roll_length_cm        numeric(7,2) not null check (roll_length_cm > 0),
  pattern_repeat_cm     numeric(6,2) not null default 0 check (pattern_repeat_cm >= 0),
  match_type            text not null default 'free' check (match_type in ('free','straight','offset','half_drop')),
  offset_cm             numeric(6,2) not null default 0,
  material text, washability text, fire_class text,
  texture_url           text,              -- tuile seamless HD calibrée
  texture_scale_px_per_cm numeric(8,3),
  thumbnail_url         text,
  dominant_colors       jsonb,
  tags                  text[] not null default '{}',
  active                boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, sku)
);
create index on wallpapers(org_id, active);

create table price_lists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  currency char(3) not null default 'CHF',
  valid_from date not null,
  valid_to date,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);
create table wallpaper_prices (
  id                  uuid primary key default gen_random_uuid(),
  price_list_id       uuid not null references price_lists(id),
  wallpaper_id        uuid not null references wallpapers(id),
  purchase_price      bigint,                 -- centimes ; jamais exposé au rôle client
  sale_price_per_roll bigint not null check (sale_price_per_roll >= 0),
  min_order_rolls     int not null default 1 check (min_order_rolls >= 1),
  stock_qty           int,
  stock_status        text,
  updated_at          timestamptz not null default now(),
  unique (price_list_id, wallpaper_id)
);
create table labor_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  type text not null check (type in ('pose_standard','pose_raccord','preparation','depose')),
  unit text not null check (unit in ('m2','hour','forfait')),
  price bigint not null check (price >= 0),  -- centimes
  valid_from date not null, valid_to date,
  check (valid_to is null or valid_to >= valid_from)
);
create table consumables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null, unit text not null,
  price bigint not null check (price >= 0),
  coverage_m2_per_unit numeric(8,2) not null check (coverage_m2_per_unit > 0),
  active boolean not null default true
);
create table tax_rates (
  id uuid primary key default gen_random_uuid(),
  country char(2) not null,
  rate_bp int not null check (rate_bp >= 0),  -- points de base : 8,1 % = 810
  valid_from date not null, valid_to date,
  label text not null,
  check (valid_to is null or valid_to >= valid_from)
);
create table discount_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  type text not null check (type in ('pct','amount')),
  max_value bigint not null,
  requires_role text not null default 'seller' check (requires_role in ('admin','seller')),
  description text
);

-- ---------------------------------------------------------------- clients & projets
create table customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  crm_external_id text,
  name text not null, email text, phone text, address text,
  consent_photos boolean not null default false,
  consent_at timestamptz,
  retention_until date,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on customers(org_id) where deleted_at is null;

create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  customer_id uuid not null references customers(id),
  seller_id uuid not null references users(id),
  name text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table rooms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  name text not null, room_type text
);
create table walls (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id),
  name text not null,
  width_cm numeric(7,2), height_cm numeric(7,2), area_m2 numeric(8,2),
  openings jsonb not null default '[]'::jsonb,
  measurement_method text check (measurement_method in ('ar','lidar','reference_object','manual')),
  measurement_confidence numeric(3,2) check (measurement_confidence between 0 and 1),
  measured_at timestamptz,
  corrected_by_user boolean not null default false,
  deleted_at timestamptz
);
create table photos (
  id uuid primary key default gen_random_uuid(),
  wall_id uuid not null references walls(id),
  storage_url text not null,
  width_px int, height_px int, exif jsonb,
  wall_quad jsonb, homography jsonb, occlusion_mask_url text,
  scale_px_per_cm numeric(8,3),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table renders (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references photos(id),
  wallpaper_id uuid not null references wallpapers(id),
  params jsonb not null default '{}'::jsonb,
  output_url text,
  quality_score numeric(3,2),
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------- devis
-- Numérotation séquentielle légale par organisation, sans trou : compteur verrouillé en transaction.
create table quote_counters (org_id uuid primary key references organizations(id), last_number bigint not null default 0);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  org_id uuid not null references organizations(id),
  number bigint,                      -- attribué à l'envoi (sent), jamais en brouillon
  version int not null default 1,
  status text not null default 'draft' check (status in ('draft','sent','viewed','accepted','refused','expired')),
  price_list_id uuid not null references price_lists(id),
  currency char(3) not null default 'CHF',
  quote_date date not null default current_date,
  engine_version text not null,
  subtotal bigint not null default 0, discount_total bigint not null default 0,
  tax_total bigint not null default 0, total bigint not null default 0,
  valid_until date,
  sent_at timestamptz, accepted_at timestamptz, accepted_ip inet,
  pdf_url text, crm_deal_id text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, number, version)
);
create table quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  kind text not null check (kind in ('wallpaper','labor','consumable','discount','custom')),
  wall_id uuid references walls(id),
  wallpaper_id uuid references wallpapers(id),
  description text not null,
  qty numeric(10,2) not null, unit text not null,
  unit_price bigint not null, line_total bigint not null,
  tax_rate_bp int not null, tax_amount bigint not null,
  computation jsonb not null default '{}'::jsonb,   -- trace complète (§5)
  position int not null default 0
);

create or replace function next_quote_number(p_org uuid) returns bigint language plpgsql as $$
declare n bigint;
begin
  insert into quote_counters(org_id) values (p_org) on conflict do nothing;
  update quote_counters set last_number = last_number + 1 where org_id = p_org returning last_number into n;
  return n;
end $$;

-- Immuabilité : un devis non brouillon ne peut plus être modifié (sauf statut/vues/acceptation).
create or replace function quotes_immutable() returns trigger language plpgsql as $$
begin
  if old.status <> 'draft' then
    if new.subtotal <> old.subtotal or new.total <> old.total or new.tax_total <> old.tax_total
       or new.discount_total <> old.discount_total or new.price_list_id <> old.price_list_id
       or new.quote_date <> old.quote_date or new.number is distinct from old.number then
      raise exception 'Devis % envoyé : immuable, créer une nouvelle version', old.id;
    end if;
  end if;
  return new;
end $$;
create trigger trg_quotes_immutable before update on quotes for each row execute function quotes_immutable();

create or replace function quote_lines_immutable() returns trigger language plpgsql as $$
declare s text;
begin
  select status into s from quotes where id = coalesce(new.quote_id, old.quote_id);
  if s is not null and s <> 'draft' then
    raise exception 'Lignes d''un devis envoyé : immuables';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_quote_lines_immutable before insert or update or delete on quote_lines
  for each row execute function quote_lines_immutable();

-- ---------------------------------------------------------------- audit
create table audit_log (
  id bigserial primary key,
  org_id uuid not null,
  user_id uuid,
  action text not null, entity text not null, entity_id uuid,
  before jsonb, after jsonb,
  at timestamptz not null default now()
);
create index on audit_log(org_id, at desc);

-- ---------------------------------------------------------------- RLS
create or replace function current_org_id() returns uuid language sql stable as $$
  select org_id from users where id = auth.uid()
$$;
create or replace function current_role_name() returns text language sql stable as $$
  select role from users where id = auth.uid()
$$;

do $$
declare t text;
begin
  foreach t in array array['organizations','users','suppliers','collections','wallpapers','price_lists','labor_rates',
    'consumables','discount_rules','customers','projects','quotes','audit_log','quote_counters'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create policy org_isolation_organizations on organizations for all using (id = current_org_id());
create policy org_isolation_users         on users         for all using (org_id = current_org_id());
create policy org_isolation_suppliers     on suppliers     for all using (org_id = current_org_id());
create policy org_isolation_collections   on collections   for all using (org_id = current_org_id());
create policy org_isolation_wallpapers    on wallpapers    for all using (org_id = current_org_id());
create policy org_isolation_price_lists   on price_lists   for all using (org_id = current_org_id());
create policy org_isolation_labor_rates   on labor_rates   for all using (org_id = current_org_id());
create policy org_isolation_consumables   on consumables   for all using (org_id = current_org_id());
create policy org_isolation_discounts     on discount_rules for all using (org_id = current_org_id());
create policy org_isolation_customers     on customers     for all using (org_id = current_org_id() and deleted_at is null);
create policy org_isolation_projects      on projects      for all using (org_id = current_org_id() and deleted_at is null);
create policy org_isolation_quotes        on quotes        for all using (org_id = current_org_id() and deleted_at is null);
create policy org_isolation_audit         on audit_log     for select using (org_id = current_org_id() and current_role_name() = 'admin');
create policy org_isolation_counters      on quote_counters for all using (org_id = current_org_id());

-- Tables filles : RLS via jointure parent
alter table wallpaper_prices enable row level security;
create policy prices_by_org on wallpaper_prices for all
  using (exists (select 1 from price_lists pl where pl.id = price_list_id and pl.org_id = current_org_id()));
-- Le rôle client ne voit jamais le prix d'achat : vue dédiée
create view wallpaper_prices_public as
  select id, price_list_id, wallpaper_id, sale_price_per_roll, min_order_rolls, stock_status, updated_at from wallpaper_prices;

alter table rooms enable row level security;
create policy rooms_by_org on rooms for all using (exists (select 1 from projects p where p.id = project_id and p.org_id = current_org_id()));
alter table walls enable row level security;
create policy walls_by_org on walls for all using (exists (select 1 from rooms r join projects p on p.id = r.project_id where r.id = room_id and p.org_id = current_org_id()));
alter table photos enable row level security;
create policy photos_by_org on photos for all using (exists (select 1 from walls w join rooms r on r.id = w.room_id join projects p on p.id = r.project_id where w.id = wall_id and p.org_id = current_org_id()));
alter table renders enable row level security;
create policy renders_by_org on renders for all using (exists (select 1 from photos ph join walls w on w.id = ph.wall_id join rooms r on r.id = w.room_id join projects p on p.id = r.project_id where ph.id = photo_id and p.org_id = current_org_id()));
alter table quote_lines enable row level security;
create policy quote_lines_by_org on quote_lines for all using (exists (select 1 from quotes q where q.id = quote_id and q.org_id = current_org_id()));
alter table tax_rates enable row level security;
create policy tax_rates_read on tax_rates for select using (true);

-- ---------------------------------------------------------------- données de référence
-- Taux TVA suisses en vigueur depuis le 01.01.2024 (À VÉRIFIER à chaque devis ; historisés, jamais écrasés).
insert into tax_rates(country, rate_bp, valid_from, label) values
  ('CH', 810, '2024-01-01', 'TVA taux normal 8,1 %'),
  ('CH', 260, '2024-01-01', 'TVA taux réduit 2,6 %'),
  ('CH', 380, '2024-01-01', 'TVA taux spécial hébergement 3,8 %');
