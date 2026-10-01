-- TaskFlow — esquema de base de datos (Postgres / Supabase)
-- Aplícalo desde el SQL Editor de Supabase, o con `supabase db push`.
-- Es idempotente: puedes correrlo de nuevo sin romper nada.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- tipos

do $$ begin
  create type public.item_source as enum ('manual', 'canvas', 'gcal', 'ics');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------- perfil

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  areas       text[]      not null default array['SFU','FINSA','Badminton','Proyectos','Personal'],
  day_start   smallint    not null default 7  check (day_start between 0 and 23),
  day_end     smallint    not null default 23 check (day_end   between 1 and 24),
  timezone    text        not null default 'America/Vancouver',
  created_at  timestamptz not null default now(),
  constraint profiles_day_range_ck check (day_end > day_start)
);

-- ---------------------------------------------------------------- tareas

create table if not exists public.tasks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  title          text not null,
  area           text,
  due_date       date,
  due_time       time,
  est_minutes    int      check (est_minutes is null or est_minutes between 1 and 1440),
  priority       smallint not null default 3 check (priority between 1 and 3),
  done           boolean  not null default false,
  done_at        timestamptz,
  body           text,
  source         public.item_source not null default 'manual',
  external_id    text,
  external_url   text,
  -- Se pone cuando el usuario edita la tarea a mano. El sync respeta estas
  -- filas: sólo refresca título y fecha, nunca done / priority / area.
  user_edited_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Enfoque del día: hasta 3 tareas fijadas para una fecha concreta. Va como
-- columna de `tasks` y no como tabla aparte para no duplicar la RLS.
alter table public.tasks add column if not exists focus_day date;

create index if not exists tasks_focus_idx on public.tasks (user_id, focus_day);

-- Esto es lo que hace que sincronizar dos veces no duplique nada.
-- Índice completo, no parcial: Postgres trata los NULL como distintos entre sí,
-- así que las tareas manuales (external_id null) no chocan. Un índice parcial
-- SÍ funcionaría para eso, pero obliga a repetir el `where` dentro de cada
-- ON CONFLICT y es un error silencioso esperando a pasar.
create unique index if not exists tasks_external_uniq
  on public.tasks (user_id, source, external_id);

create index if not exists tasks_due_idx on public.tasks (user_id, done, due_date);

-- ------------------------------------------------------------- calendario

create table if not exists public.events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null,
  -- Evento con hora: starts_at / ends_at. Evento de día completo: all_day_date.
  -- Nunca los dos a la vez.
  starts_at    timestamptz,
  ends_at      timestamptz,
  all_day_date date,
  location     text,
  course_ref   text,
  source       public.item_source not null,
  external_id  text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint events_when_ck check (
    (starts_at is not null and all_day_date is null) or
    (starts_at is null     and all_day_date is not null)
  ),
  constraint events_order_ck check (ends_at is null or ends_at >= starts_at)
);

create unique index if not exists events_external_uniq
  on public.events (user_id, source, external_id);

create index if not exists events_starts_idx on public.events (user_id, starts_at);
create index if not exists events_allday_idx on public.events (user_id, all_day_date);

-- ----------------------------------------------------------------- notas

create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  body       text not null,
  pinned     boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notes_recent_idx on public.notes (user_id, pinned desc, created_at desc);

-- --------------------------------------------------------------- rutinas

create table if not exists public.habits (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  -- Días de la semana en que aplica, 0 = domingo.
  days       smallint[] not null default '{0,1,2,3,4,5,6}'::smallint[],
  archived   boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.habit_log (
  habit_id uuid not null references public.habits (id) on delete cascade,
  user_id  uuid not null references auth.users (id) on delete cascade,
  day      date not null,
  primary key (habit_id, day)
);

create index if not exists habit_log_user_day_idx on public.habit_log (user_id, day desc);

-- ------------------------------------------------------- bloques del día

create table if not exists public.blocks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  day        date not null,
  -- Minutos desde medianoche, hora local del usuario.
  start_min  smallint not null check (start_min between 0 and 1439),
  end_min    smallint not null check (end_min   between 1 and 1440),
  title      text not null,
  kind       text not null default 'tarea' check (kind in ('tarea','descanso','clase')),
  task_id    uuid references public.tasks (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint blocks_order_ck check (end_min > start_min)
);

create index if not exists blocks_day_idx on public.blocks (user_id, day, start_min);

-- ------------------------------------------------- suscripciones de push

-- Un navegador que aceptó recibir avisos. La clave es el endpoint que da el
-- servicio de push, así que reinstalar la app en el mismo navegador actualiza
-- la fila en vez de duplicarla.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subs_user_idx on public.push_subscriptions (user_id);

-- ------------------------------------------------------ estado del sync

-- Una fila por integración y usuario: cuándo corrió, cuándo salió bien y qué
-- falló. Es lo que lee Ajustes → Estado del sistema.
--
-- `last_synced_at` es el último INTENTO; `last_success_at`, el último que salió
-- bien. Antes había sólo el primero, y un token vencido seguía mostrando
-- "sincronizado hace 1 h" durante días.
create table if not exists public.sync_state (
  user_id        uuid not null references auth.users (id) on delete cascade,
  source         text not null,
  last_synced_at timestamptz,
  last_error     text,
  items_synced   int not null default 0,
  primary key (user_id, source)
);

-- `source` nació como `item_source` (manual/canvas/gcal/ics). Se ensancha a
-- texto para que el reloj, el push, Telegram y la IA guarden aquí su estado
-- sin meter valores raros en el enum que también usan `tasks` y `events`.
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sync_state'
      and column_name = 'source' and data_type = 'USER-DEFINED'
  ) then
    alter table public.sync_state alter column source type text using source::text;
  end if;
end $$;

alter table public.sync_state drop constraint if exists sync_state_source_ck;
alter table public.sync_state add constraint sync_state_source_ck
  check (source in ('canvas', 'gcal', 'ics', 'cron', 'push', 'telegram', 'ai'));

alter table public.sync_state add column if not exists last_success_at timestamptz;
alter table public.sync_state add column if not exists last_error_at   timestamptz;
alter table public.sync_state add column if not exists last_error_code text;

-- Las filas de antes de esta columna: si la última corrida no dejó error, fue
-- un éxito. Sólo toca filas que todavía no tienen el dato.
update public.sync_state
  set last_success_at = last_synced_at
  where last_success_at is null and last_error is null and last_synced_at is not null;

-- ------------------------------------------------------ avisos ya enviados

-- Un aviso por día y por tipo, y ya.
--
-- El reloj corre cada hora y pregunta "¿toca avisar?". Sin esta tabla, la
-- respuesta sería "sí" todas las horas de la ventana y el mismo resumen
-- saldría cinco veces seguidas. Lo que lo impide es la clave primaria: el
-- segundo intento del día choca contra ella y no manda nada. Deliberadamente
-- no es una bandera ni un contador en `profiles` — eso se desincroniza en
-- cuanto dos corridas se pisan; una fila existe o no existe.
--
-- `day` es el día LOCAL en que se mandó, no el que describe: el aviso de la
-- noche del lunes habla del martes, pero se guarda como (lunes, 'night').
create table if not exists public.digest_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  kind    text not null check (kind in ('morning', 'night')),
  sent_at timestamptz not null default now(),
  primary key (user_id, day, kind)
);

-- ------------------------------------------------------------- Telegram

-- El chat de Telegram donde llegan los avisos. Uno por usuario.
--
-- La conexión se hace con un código de un solo uso: Ajustes genera
-- `link_code`, el usuario abre t.me/<bot>?start=<código>, Telegram le manda al
-- webhook "/start <código>" desde su chat, y ahí se guarda `chat_id` y el
-- código se borra. Así nadie tiene que copiar ni pegar un número de chat, y un
-- código viejo o ajeno no conecta nada.
create table if not exists public.telegram_chats (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  chat_id         bigint unique,
  link_code       text unique,
  link_expires_at timestamptz,
  linked_at       timestamptz,
  created_at      timestamptz not null default now()
);

-- ------------------------------------------------------------- triggers

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

-- Crea el perfil en cuanto alguien se registra.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------ RLS
-- Sin esto, cualquiera con la anon key (que es pública) lee todas tus filas.

alter table public.profiles   enable row level security;
alter table public.tasks      enable row level security;
alter table public.events     enable row level security;
alter table public.notes      enable row level security;
alter table public.habits     enable row level security;
alter table public.habit_log  enable row level security;
alter table public.blocks     enable row level security;
alter table public.sync_state enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.digest_log enable row level security;
alter table public.telegram_chats enable row level security;

drop policy if exists own_profile on public.profiles;
create policy own_profile on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists own_tasks on public.tasks;
create policy own_tasks on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists own_events on public.events;
create policy own_events on public.events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists own_notes on public.notes;
create policy own_notes on public.notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists own_habits on public.habits;
create policy own_habits on public.habits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- La clave de `habit_log` es (habit_id, day). Si alguien pudiera escribir una
-- fila propia con el `habit_id` de otro, ocuparía ese día y el dueño ya no
-- podría marcar su rutina sin ver siquiera qué se lo impide. Por eso la rutina
-- también tiene que ser tuya.
drop policy if exists own_habit_log on public.habit_log;
create policy own_habit_log on public.habit_log
  for all using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.habits h where h.id = habit_id and h.user_id = auth.uid())
  );

-- Lo mismo con `blocks.task_id`: la clave foránea sólo comprueba que la tarea
-- exista, no de quién es.
drop policy if exists own_blocks on public.blocks;
create policy own_blocks on public.blocks
  for all using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (task_id is null or exists (select 1 from public.tasks t where t.id = task_id and t.user_id = auth.uid()))
  );

drop policy if exists own_sync_state on public.sync_state;
create policy own_sync_state on public.sync_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists own_push_subscriptions on public.push_subscriptions;
create policy own_push_subscriptions on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists own_digest_log on public.digest_log;
create policy own_digest_log on public.digest_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists own_telegram_chats on public.telegram_chats;
create policy own_telegram_chats on public.telegram_chats
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
