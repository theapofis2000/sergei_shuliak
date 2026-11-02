-- Схема публичной формы, исторических просмотров и дневных уникальных браузеров.
-- Публичные посетители могут вызвать только две проверяющие функции ниже;
-- прямого чтения таблиц через API у них нет.

create table if not exists public.contact_messages (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    name text not null check (char_length(name) between 1 and 100),
    email text not null check (char_length(email) between 3 and 254),
    message text not null check (char_length(message) between 1 and 5000)
);

alter table public.contact_messages enable row level security;
revoke all on table public.contact_messages from public, anon, authenticated;

create table if not exists public.daily_visits (
    visit_date date primary key,
    views bigint not null default 0 check (views >= 0)
);

alter table public.daily_visits enable row level security;
revoke all on table public.daily_visits from public, anon, authenticated;

-- Сводка уникальных браузеров по UTC-дням и закрытый набор случайных дневных ID.
create table if not exists public.daily_unique_visits (
    visit_date date primary key,
    visitors bigint not null default 0 check (visitors >= 0)
);

create table if not exists public.daily_visitor_ids (
    visit_date date not null,
    visitor_id uuid not null,
    primary key (visit_date, visitor_id)
);

alter table public.daily_unique_visits enable row level security;
alter table public.daily_visitor_ids enable row level security;
revoke all on table public.daily_unique_visits from public, anon, authenticated;
revoke all on table public.daily_visitor_ids from public, anon, authenticated;

grant usage on schema public to anon;

create or replace function public.submit_contact_message(
    p_name text,
    p_email text,
    p_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_name text := btrim(coalesce(p_name, ''));
    v_email text := btrim(coalesce(p_email, ''));
    v_message text := btrim(coalesce(p_message, ''));
begin
    if char_length(v_name) not between 1 and 100 then
        raise exception using errcode = '22023', message = 'Invalid name';
    end if;

    if char_length(v_email) not between 3 and 254
       or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
        raise exception using errcode = '22023', message = 'Invalid email';
    end if;

    if char_length(v_message) not between 1 and 5000 then
        raise exception using errcode = '22023', message = 'Invalid message';
    end if;

    insert into public.contact_messages (name, email, message)
    values (v_name, v_email, v_message);
end;
$$;

revoke all on function public.submit_contact_message(text, text, text) from public, anon, authenticated;
grant execute on function public.submit_contact_message(text, text, text) to anon;

create or replace function public.record_site_visit()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.daily_visits as existing (visit_date, views)
    values ((now() at time zone 'UTC')::date, 1)
    on conflict (visit_date)
    do update set views = existing.views + 1;
end;
$$;

revoke all on function public.record_site_visit() from public, anon, authenticated;
-- Legacy page-view RPC is intentionally not exposed by the new version of the site.

create or replace function public.record_unique_site_visit(p_visitor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_visit_date date := (pg_catalog.now() at time zone 'UTC')::date;
    v_inserted integer;
begin
    if p_visitor_id is null then
        raise exception using errcode = '22023', message = 'Invalid visitor ID';
    end if;

    insert into public.daily_visitor_ids (visit_date, visitor_id)
    values (v_visit_date, p_visitor_id)
    on conflict (visit_date, visitor_id) do nothing;

    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
        return;
    end if;

    delete from public.daily_visitor_ids
    where visit_date < v_visit_date;

    insert into public.daily_unique_visits as existing (visit_date, visitors)
    values (v_visit_date, 1)
    on conflict (visit_date)
    do update set visitors = existing.visitors + 1;
end;
$$;

revoke all on function public.record_unique_site_visit(uuid) from public, anon, authenticated;
grant execute on function public.record_unique_site_visit(uuid) to anon;
