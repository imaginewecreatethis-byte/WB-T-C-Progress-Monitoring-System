-- ============================================================================
-- WB-T&C  —  Supabase update #5   (run ONCE in SQL Editor -> New query)
--
-- Run this AFTER 2-upgrade.sql, 3-update.sql and 4-update.sql. Safe to run again.
--
-- Adds:
--   * Delete Student (Teacher or Admin) and Delete Teacher (Admin only)
--     - the account, every file row and the student's progress are removed
--     - a "Recently deleted" record is kept for the Admin (name, who, when)
--   * Renames the two starting logins (passwords stay the same):
--       santos  -> cecilia.nacpil   (shown as  Cecilia Q. Nacpil)
--       reyes   -> zedrick.reyes    (shown as  Mr. Zedrick Duane M. Reyes)
-- ============================================================================

-- ---------- 1. recently deleted record ---------------------------------------
create table if not exists public.deleted_people (
  id            uuid primary key default gen_random_uuid(),
  deleted_at    timestamptz not null default now(),
  kind          text not null check (kind in ('student','teacher')),
  person_name   text not null,
  username      text,
  program       text,
  files_removed int  not null default 0,
  deleted_by    uuid,
  deleted_by_name text,
  deleted_by_role text
);
alter table public.deleted_people enable row level security;
drop policy if exists "deleted record read" on public.deleted_people;
create policy "deleted record read" on public.deleted_people for select to authenticated
  using (public.is_superadmin());
-- nobody can insert / update / delete these rows from the browser: only the functions below do
revoke all on public.deleted_people from anon;
revoke insert, update, delete on public.deleted_people from authenticated;
grant select on public.deleted_people to authenticated;

-- ---------- 2. delete a student (Teacher or Admin) ----------------------------
-- Returns the stored file paths so the site can remove the files from Storage.
create or replace function public.delete_student(p_id uuid)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  me public.profiles; st public.profiles; paths text[]; me_user text;
begin
  select * into me from public.profiles
   where id = auth.uid() and role in ('admin','superadmin') and status = 'active';
  if not found then raise exception 'Not allowed.'; end if;

  select * into st from public.profiles where id = p_id and role = 'user';
  if not found then raise exception 'Student not found.'; end if;

  select coalesce(array_agg(storage_path), '{}') into paths from public.submissions where user_id = st.id;
  me_user := split_part(coalesce(me.email,''), '@', 1);

  insert into public.deleted_people (kind, person_name, username, program, files_removed, deleted_by, deleted_by_name, deleted_by_role)
  values ('student', st.name, split_part(coalesce(st.email,''), '@', 1), st.program,
          cardinality(paths), me.id, me.name, me.role);

  delete from public.notification_state where user_id = st.id;
  delete from public.submissions        where user_id = st.id;
  delete from public.profiles           where id = st.id;
  delete from auth.users                where id = st.id;
  return paths;
end $$;

-- ---------- 3. delete a teacher (Admin only) -----------------------------------
create or replace function public.delete_teacher(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me public.profiles; t public.profiles;
begin
  select * into me from public.profiles
   where id = auth.uid() and role = 'superadmin' and status = 'active';
  if not found then raise exception 'Not allowed.'; end if;

  select * into t from public.profiles where id = p_id and role = 'admin';
  if not found then raise exception 'Teacher not found.'; end if;

  insert into public.deleted_people (kind, person_name, username, program, files_removed, deleted_by, deleted_by_name, deleted_by_role)
  values ('teacher', t.name, split_part(coalesce(t.email,''), '@', 1), null, 0, me.id, me.name, me.role);

  delete from public.notification_state where user_id = t.id;
  delete from public.profiles           where id = t.id;
  delete from auth.users                where id = t.id;
end $$;

revoke all on function public.delete_student(uuid) from public, anon;
grant execute on function public.delete_student(uuid) to authenticated;
revoke all on function public.delete_teacher(uuid) from public, anon;
grant execute on function public.delete_teacher(uuid) to authenticated;

-- ---------- 4. rename the two starting logins (password hashes are untouched) ---
do $$
declare uid_ uuid;
begin
  -- Admin: santos -> cecilia.nacpil
  select id into uid_ from auth.users where email = 'santos@pup.edu.ph';
  if uid_ is not null and not exists (select 1 from auth.users where email = 'cecilia.nacpil@pup.edu.ph') then
    update auth.users set email = 'cecilia.nacpil@pup.edu.ph',
           raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"name":"Cecilia Q. Nacpil"}'::jsonb,
           updated_at = now()
     where id = uid_;
    update auth.identities
       set identity_data = identity_data || '{"email":"cecilia.nacpil@pup.edu.ph"}'::jsonb, updated_at = now()
     where user_id = uid_ and provider = 'email';
    update public.profiles set email = 'cecilia.nacpil@pup.edu.ph', name = 'Cecilia Q. Nacpil' where id = uid_;
  end if;

  -- Teacher: reyes -> zedrick.reyes
  select id into uid_ from auth.users where email = 'reyes@pup.edu.ph';
  if uid_ is not null and not exists (select 1 from auth.users where email = 'zedrick.reyes@pup.edu.ph') then
    update auth.users set email = 'zedrick.reyes@pup.edu.ph',
           raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"name":"Mr. Zedrick Duane M. Reyes"}'::jsonb,
           updated_at = now()
     where id = uid_;
    update auth.identities
       set identity_data = identity_data || '{"email":"zedrick.reyes@pup.edu.ph"}'::jsonb, updated_at = now()
     where user_id = uid_ and provider = 'email';
    update public.profiles set email = 'zedrick.reyes@pup.edu.ph', name = 'Mr. Zedrick Duane M. Reyes' where id = uid_;
  end if;
end $$;

-- Check: the two staff logins and the new record table
select email, name, role, status from public.profiles where role in ('superadmin','admin') order by created_at;
