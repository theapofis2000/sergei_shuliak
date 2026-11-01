-- Безопасная схема для публичной формы и счётчика просмотров.
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
grant execute on function public.record_site_visit() to anon;
