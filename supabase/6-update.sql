-- ============================================================================
-- WB-T&C  —  Supabase update #6   (run ONCE in SQL Editor -> New query)
--
-- Run AFTER 2-upgrade.sql ... 5-update.sql. Safe to run again.
--
-- Adds:
--   * name_registered(name)  - registration is blocked when the same name
--                              (any program) already has an account
--   * admin_set_password()   - the Admin sets a new password for a Teacher or
--                              Student. That person is signed out everywhere.
-- ============================================================================

create or replace function public.name_registered(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
         = lower(regexp_replace(trim(coalesce(p_name,'')), '\s+', ' ', 'g'))
       and role = 'user'
  );
$$;
revoke all on function public.name_registered(text) from public;
grant execute on function public.name_registered(text) to anon, authenticated;

create or replace function public.admin_set_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  me public.profiles; t public.profiles;
begin
  select * into me from public.profiles
   where id = auth.uid() and role = 'superadmin' and status = 'active';
  if not found then raise exception 'Not allowed.'; end if;

  select * into t from public.profiles where id = p_user and role in ('user','admin');
  if not found then raise exception 'Account not found.'; end if;

  if p_password is null or length(p_password) < 6 or length(p_password) > 64 then
    raise exception 'Password must be 6-64 characters.';
  end if;
  if public.text_problem(p_password) is not null then
    raise exception 'That password is not allowed.';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = t.id;
  delete from auth.sessions where user_id = t.id;
end $$;
revoke all on function public.admin_set_password(uuid, text) from public, anon;
grant execute on function public.admin_set_password(uuid, text) to authenticated;

select 'update 6 installed' as result;
