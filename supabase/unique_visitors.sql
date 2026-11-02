-- Миграция для уже подключённого сайта: считает случайные браузерные ID один раз за UTC-день.
-- Запустите до обновлённого supabase/email_notifications.sql.

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

    -- ID нужен только для подсчёта в текущий день; старые записи удаляются при новом ID.
    delete from public.daily_visitor_ids
    where visit_date < v_visit_date;

    insert into public.daily_unique_visits as existing (visit_date, visitors)
    values (v_visit_date, 1)
    on conflict (visit_date)
    do update set visitors = existing.visitors + 1;
end;
$$;

-- Отключаем старый RPC подсчёта загрузок: обновлённый сайт использует новую функцию.
revoke all on function public.record_site_visit() from public, anon, authenticated;
revoke all on function public.record_unique_site_visit(uuid) from public, anon, authenticated;
grant execute on function public.record_unique_site_visit(uuid) to anon;

-- Если был включён старый email-триггер просмотров, перестаём отправлять письма на pageviews.
drop trigger if exists notify_site_visit_by_email on public.daily_visits;
