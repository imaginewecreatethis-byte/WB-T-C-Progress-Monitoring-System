-- ============================================================================
-- WB-T&C  —  Supabase upgrade script  (run ONCE in SQL Editor -> New query)
-- Run this AFTER the first script that created the `profiles` and
-- `submissions` tables. Safe to re-run: every step is "if not exists" /
-- "drop then create".
-- ============================================================================

-- ---------- 1. columns and allowed values ----------------------------------
alter table public.profiles    add column if not exists email text;
alter table public.submissions add column if not exists file_size bigint;

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add  constraint profiles_status_check
  check (status in ('pending','approved','rejected','active','inactive'));

-- ONE person per course: same name (any capitalisation) + same program can
-- only exist once among students.
create unique index if not exists profiles_one_person_per_program
  on public.profiles (lower(name), program)
  where role = 'user' and program is not null;

-- ---------- 2. helper functions (security definer = skip RLS inside) --------
create or replace function public.is_staff()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role in ('admin','superadmin') and status = 'active');
$$;

create or replace function public.is_superadmin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'superadmin' and status = 'active');
$$;

-- The course of the logged-in student, only once an Admin has approved them
create or replace function public.my_program()
returns text language sql security definer stable set search_path = public as $$
  select program from public.profiles where id = auth.uid() and status = 'approved';
$$;

-- ---------- 3. every new login automatically gets a profile row --------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := left(regexp_replace(trim(coalesce(new.raw_user_meta_data->>'name','')), '\s+', ' ', 'g'), 60);
  v_prog text := new.raw_user_meta_data->>'program';
begin
  insert into public.profiles (id, email, name, program)
  values (
    new.id, lower(new.email),
    coalesce(nullif(v_name, ''), split_part(new.email, '@', 1)),
    case when v_prog in ('BSIT','DIT','BSIE','BSBA') then v_prog else null end
  );
  return new;   -- role is ALWAYS 'user' and status ALWAYS 'pending' here
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- 4. stop admins editing roles / other admins ----------------------
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;        -- SQL Editor / dashboard
  if not public.is_superadmin() then
    if new.role is distinct from old.role then
      raise exception 'Only a Super Admin can change roles.';
    end if;
    if old.role <> 'user' then
      raise exception 'Only a Super Admin can change staff accounts.';
    end if;
  end if;
  new.id := old.id; new.email := old.email; new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update
  before update on public.profiles for each row execute function public.guard_profile_update();

-- ---------- 5. row level security: profiles ---------------------------------
alter table public.profiles enable row level security;
drop policy if exists "own or staff read" on public.profiles;
drop policy if exists "staff update"      on public.profiles;
drop policy if exists "self insert"       on public.profiles;
drop policy if exists profiles_read       on public.profiles;
drop policy if exists profiles_staff_update on public.profiles;

-- you see yourself; staff see everyone; an approved student also sees the
-- other APPROVED students of the same course (needed for the shared gallery)
create policy profiles_read on public.profiles for select using (
  auth.uid() = id
  or public.is_staff()
  or (role = 'user' and status = 'approved' and program = public.my_program())
);
create policy profiles_staff_update on public.profiles for update
  using (public.is_staff()) with check (public.is_staff());
-- (no insert/delete policies: profiles are created by the trigger above and
--  removed only through reject_user() below)

-- ---------- 6. row level security: submissions ------------------------------
alter table public.submissions enable row level security;
drop policy if exists "course or own or staff read" on public.submissions;
drop policy if exists "self insert submission"      on public.submissions;
drop policy if exists submissions_read   on public.submissions;
drop policy if exists submissions_insert on public.submissions;

create policy submissions_read on public.submissions for select using (
  user_id = auth.uid()
  or public.is_staff()
  or exists (select 1 from public.profiles p
             where p.id = submissions.user_id
               and p.status = 'approved'
               and p.program = public.my_program())
);
-- upload only for yourself, only when approved, only for an UNLOCKED requirement
create policy submissions_insert on public.submissions for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.profiles p
              where p.id = auth.uid() and p.status = 'approved'
                and task_id = any (p.unlocked_tasks))
);

-- ---------- 7. functions the sign-up page calls -----------------------------
create or replace function public.username_taken(p_email text)
returns boolean language sql security definer stable set search_path = public, auth as $$
  select exists (select 1 from auth.users where lower(email) = lower(p_email));
$$;

create or replace function public.person_registered(p_name text, p_program text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles
                 where role = 'user' and program = p_program
                   and lower(name) = lower(regexp_replace(trim(p_name), '\s+', ' ', 'g')));
$$;

-- "Reject" in the Admin console = delete the student's login completely
create or replace function public.reject_user(target uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_staff() then raise exception 'Not allowed.'; end if;
  delete from auth.users u using public.profiles p
   where u.id = target and p.id = u.id and p.role = 'user';
end $$;

grant execute on function public.username_taken(text)           to anon, authenticated;
grant execute on function public.person_registered(text, text)  to anon, authenticated;
grant execute on function public.reject_user(uuid)              to authenticated;

-- ---------- 8. storage: the `submissions` bucket -----------------------------
update storage.buckets set file_size_limit = 10485760 where id = 'submissions';  -- 10 MB

drop policy if exists "upload to own folder"      on storage.objects;
drop policy if exists "read submissions bucket"   on storage.objects;
drop policy if exists "delete own files"          on storage.objects;
drop policy if exists "submissions upload"        on storage.objects;
drop policy if exists "submissions read"          on storage.objects;
drop policy if exists "submissions cleanup"       on storage.objects;

-- upload only into your own folder, and only when you're approved
create policy "submissions upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'submissions'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.profiles p
              where p.id = auth.uid() and p.status = 'approved'
                and cardinality(p.unlocked_tasks) > 0)
);
-- you can open a file only if the `submissions` table lets you see its row
-- (own files, same-course classmates, or staff)
create policy "submissions read" on storage.objects for select to authenticated using (
  bucket_id = 'submissions'
  and exists (select 1 from public.submissions s where s.storage_path = name)
);
-- lets the site clean up a half-finished upload (file saved, row not saved)
create policy "submissions cleanup" on storage.objects for delete to authenticated using (
  bucket_id = 'submissions'
  and (storage.foldername(name))[1] = auth.uid()::text
  and not exists (select 1 from public.submissions s where s.storage_path = name)
);

-- ---------- 9. the Super Admin and Admin accounts (same logins as before) ----
do $$
declare
  sa uuid := gen_random_uuid();
  ad uuid := gen_random_uuid();
begin
  if not exists (select 1 from auth.users where email = 'santos@pup.edu.ph') then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', sa, 'authenticated', 'authenticated',
            'santos@pup.edu.ph', extensions.crypt('super123', extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', '{"name":"Dr. Elena Santos"}',
            now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), sa, sa::text,
            jsonb_build_object('sub', sa::text, 'email', 'santos@pup.edu.ph', 'email_verified', true),
            'email', now(), now(), now());
    update public.profiles set role = 'superadmin', status = 'active', program = null where id = sa;
  end if;

  if not exists (select 1 from auth.users where email = 'reyes@pup.edu.ph') then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', ad, 'authenticated', 'authenticated',
            'reyes@pup.edu.ph', extensions.crypt('admin123', extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', '{"name":"Prof. Miguel Reyes"}',
            now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), ad, ad::text,
            jsonb_build_object('sub', ad::text, 'email', 'reyes@pup.edu.ph', 'email_verified', true),
            'email', now(), now(), now());
    update public.profiles set role = 'admin', status = 'active', program = null where id = ad;
  end if;
end $$;

-- Check: should list the two staff accounts
select email, name, role, status from public.profiles order by created_at;
