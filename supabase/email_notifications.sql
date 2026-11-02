-- Отправлять письма после новых сообщений и первого уникального браузера за день.
-- До запуска:
-- 1. Включите расширение pg_net в Supabase: Database -> Extensions.
-- 2. Добавьте в Supabase Vault секреты с именами:
--    email_notification_webhook_secret
--    email_notification_webhook_url
-- 3. URL должен быть URL развернутого Apps Script Web App и заканчиваться на /exec.

create or replace function public.dispatch_email_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_webhook_secret text;
    v_webhook_url text;
    v_event text;
begin
    select decrypted_secret
    into v_webhook_secret
    from vault.decrypted_secrets
    where name = 'email_notification_webhook_secret';

    select decrypted_secret
    into v_webhook_url
    from vault.decrypted_secrets
    where name = 'email_notification_webhook_url';

    if coalesce(v_webhook_secret, '') = '' or coalesce(v_webhook_url, '') = '' then
        raise warning 'Email notification URL or secret is missing from Supabase Vault.';
        return new;
    end if;

    if tg_table_name = 'contact_messages' then
        v_event := 'contact_message';
    elsif tg_table_name = 'daily_unique_visits' then
        v_event := 'site_visit';
    else
        return new;
    end if;

    begin
        perform net.http_post(
            url := v_webhook_url,
            headers := jsonb_build_object('Content-Type', 'application/json'),
            body := jsonb_build_object(
                'secret', v_webhook_secret,
                'event', v_event,
                'record', to_jsonb(new)
            ),
            timeout_milliseconds := 10000
        );
    exception when others then
        -- A notification transport failure must not undo a saved form or visit count.
        raise warning 'Could not queue email notification; check Supabase logs and Vault configuration.';
    end;

    return new;
end;
$$;

revoke all on function public.dispatch_email_notification() from public, anon, authenticated;

drop trigger if exists notify_contact_message_by_email on public.contact_messages;
create trigger notify_contact_message_by_email
after insert on public.contact_messages
for each row execute function public.dispatch_email_notification();

drop trigger if exists notify_site_visit_by_email on public.daily_visits;
drop trigger if exists notify_site_visit_by_email on public.daily_unique_visits;
create trigger notify_site_visit_by_email
after insert on public.daily_unique_visits
for each row execute function public.dispatch_email_notification();
