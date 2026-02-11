-- =========================
-- ShaSitter — SCHEMA v2 (PACKS + SERVICES + SUPPLÉMENTS + MENAGE + DEVIS)
-- =========================
-- Notes:
-- - "supplement" et "menage" sont UNIQUES (1 seule fois), pas multipliés par jours.
-- - "pack" = prix par jour (visits_per_day 1 ou 2).
-- - "service" = prix par visite (si slot=matin_soir => x2 / jour).
-- - "devis" = ligne spéciale, montant libre (total_chf override côté bot/dashboard).

create extension if not exists pgcrypto;

-- =========================
-- RESET
-- =========================
drop table if exists public.payments cascade;
drop table if exists public.bookings cascade;
drop table if exists public.pets cascade;
drop table if exists public.prestations cascade;
drop table if exists public.clients cascade;
drop table if exists public.employees cascade;

-- =========================
-- CLIENTS
-- =========================
create table public.clients (
  id bigserial primary key,
  name text not null,
  phone text not null default '',
  address text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index clients_name_idx on public.clients(name);

-- =========================
-- EMPLOYEES
-- =========================
create table public.employees (
  id bigserial primary key,
  name text not null,
  phone text not null default '',
  default_percent int not null default 0 check (default_percent between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index employees_name_idx on public.employees(name);

-- =========================
-- PRESTATIONS (CATALOGUE)
-- =========================
create table public.prestations (
  id bigserial primary key,
  name text not null,

  category text not null check (category in ('pack','service','supplement','menage','devis')),

  animal_type text not null default 'autre' check (animal_type in ('chat','lapin','autre')),
  price_chf numeric(10,2) not null default 0 check (price_chf >= 0),

  visits_per_day int not null default 1 check (visits_per_day in (1,2)),
  duration_min int not null default 0 check (duration_min >= 0),

  description text not null default '',
  image_url text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index prestations_cat_idx on public.prestations(category);
create index prestations_animal_idx on public.prestations(animal_type);
create index prestations_name_idx on public.prestations(name);

-- =========================
-- PETS (ANIMAUX)
-- =========================
create table public.pets (
  id bigserial primary key,
  client_id bigint not null references public.clients(id) on delete cascade,
  name text not null,
  animal_type text not null default 'chat' check (animal_type in ('chat','lapin','autre')),
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index pets_client_idx on public.pets(client_id);

-- =========================
-- BOOKINGS (LIGNES DE GARDE)
-- =========================
create table public.bookings (
  id bigserial primary key,

  group_id uuid not null default gen_random_uuid(), -- regroupe les lignes (segments + options)

  client_id bigint not null references public.clients(id),
  pet_id bigint references public.pets(id),
  prestation_id bigint not null references public.prestations(id),

  slot text null check (slot in ('matin','soir','matin_soir')),

  start_date date not null,
  end_date date not null,
  days_count int not null default 1 check (days_count >= 1),

  total_chf numeric(10,2) not null default 0,

  employee_id bigint references public.employees(id),
  employee_percent int not null default 0 check (employee_percent between 0 and 100),
  employee_part_chf numeric(10,2) not null default 0,
  company_part_chf numeric(10,2) not null default 0,

  notes text not null default '',
  status text not null default 'confirmed'
    check (status in ('draft','confirmed','cancelled','done')),

  created_at timestamptz not null default now()
);

create index bookings_group_idx on public.bookings(group_id);
create index bookings_client_idx on public.bookings(client_id);
create index bookings_dates_idx on public.bookings(start_date, end_date);

-- =========================
-- PAYMENTS
-- =========================
create table public.payments (
  id bigserial primary key,
  booking_id bigint not null references public.bookings(id) on delete cascade,
  amount_chf numeric(10,2) not null,
  method text not null default 'cash'
    check (method in ('cash','twint','bank','card','other')),
  paid_at timestamptz not null default now(),
  note text not null default ''
);

-- =========================
-- VIEW COMPTA (optionnel)
-- =========================
create or replace view public.v_compta_bookings as
select
  b.id,
  b.group_id,
  b.start_date,
  b.end_date,
  to_char(b.start_date, 'YYYY-MM') as month,
  b.total_chf,
  b.employee_part_chf,
  b.company_part_chf,
  c.name as client_name,
  pt.name as pet_name,
  p.name as prestation_name,
  p.category,
  e.name as employee_name
from public.bookings b
join public.clients c on c.id = b.client_id
left join public.pets pt on pt.id = b.pet_id
join public.prestations p on p.id = b.prestation_id
left join public.employees e on e.id = b.employee_id;

-- =========================
-- SEED (CHAT + OPTIONS)
-- =========================
insert into public.prestations
(name, category, animal_type, price_chf, visits_per_day, duration_min, description)
values
-- PACKS CHAT (1 visite / jour)
('Pack Essentiel', 'pack', 'chat', 15, 1, 15, 'Visite essentielle'),
('Pack Tendresse', 'pack', 'chat', 25, 1, 30, 'Visite avec câlins'),
('Pack Confort', 'pack', 'chat', 35, 1, 45, 'Visite longue'),
('Pack Complicité', 'pack', 'chat', 45, 1, 60, 'Visite premium'),
('Pack Sur-Mesure', 'pack', 'chat', 0, 1, 0, 'Sur demande (devis)'),

-- PACKS CHAT (2 visites / jour)
('Pack Duo Essentiel', 'pack', 'chat', 26, 2, 30, '2 visites / jour'),
('Pack Duo Tendresse', 'pack', 'chat', 46, 2, 60, '2 visites / jour'),
('Pack Duo Confort', 'pack', 'chat', 66, 2, 90, '2 visites longues'),
('Pack Duo Complicité', 'pack', 'chat', 86, 2, 120, '2 visites premium'),
('Pack Duo Sur-Mesure', 'pack', 'chat', 0, 2, 0, 'Sur demande (devis)'),

-- SERVICES (par visite) — utile si tu veux proposer "15/20/30/1h" hors packs
('Visite 15 min', 'service', 'chat', 15, 1, 15, 'Tarif par visite'),
('Visite 20 min', 'service', 'chat', 0, 1, 20, 'Tarif par visite (à ajuster)'),
('Visite 30 min', 'service', 'chat', 25, 1, 30, 'Tarif par visite'),
('Visite 45 min', 'service', 'chat', 35, 1, 45, 'Tarif par visite'),
('Visite 60 min', 'service', 'chat', 45, 1, 60, 'Tarif par visite'),

-- SUPPLÉMENTS (UNIQUES)
('Supplément multi-chat', 'supplement', 'autre', 10, 1, 0, 'Unique (1 seule fois)'),
('Administration médicaments / soins', 'supplement', 'autre', 10, 1, 0, 'Supplément unique'),
('Arrosage des plantes', 'supplement', 'autre', 6, 1, 0, 'Supplément unique'),
('Relever le courrier', 'supplement', 'autre', 6, 1, 0, 'Supplément unique'),
('Remise des clés', 'supplement', 'autre', 6, 1, 0, 'Supplément unique'),
('Ouverture / fermeture des stores', 'supplement', 'autre', 6, 1, 0, 'Supplément unique'),
('Accompagnement vétérinaire', 'supplement', 'autre', 30, 1, 0, 'Accompagnement + facture'),
('Brossage régulier', 'supplement', 'autre', 6, 1, 0, 'Supplément unique'),
('Courses / achat fournitures', 'supplement', 'autre', 12, 1, 0, 'Courses + quittance'),
('Envoi photos / vidéos', 'supplement', 'autre', 0, 1, 0, 'Gratuit'),
('Nettoyage yeux / oreilles', 'supplement', 'autre', 6, 1, 0, 'Supplément unique'),

-- MENAGE (à ajouter pendant une garde)
('Ménage 1h30', 'menage', 'autre', 55, 1, 90, 'Nettoyage'),
('Ménage 3h', 'menage', 'autre', 110, 1, 180, 'Nettoyage'),
('Ménage 4h30', 'menage', 'autre', 165, 1, 270, 'Nettoyage'),

-- DEVIS
('Devis personnalisé', 'devis', 'autre', 0, 1, 0, 'Montant libre');
