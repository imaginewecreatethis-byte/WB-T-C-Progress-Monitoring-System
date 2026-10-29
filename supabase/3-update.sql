-- ============================================================================
-- WB-T&C  —  Supabase update #3   (run ONCE in SQL Editor -> New query)
--
-- Run this AFTER 2-upgrade.sql. Safe to run again: every step is
-- "if not exists" / "drop then create".
--
-- Adds:
--   * Notifications and Revision Notices (who sees what is enforced here)
--   * Revision notice sending, and file removal (student removes own file,
--     Admin/Teacher delete a file with a note)
--   * Only PDF / PowerPoint / Word documents; ONE file per requirement
--   * Columns that hold the automatic progress % and layout/grammar results
--
-- Role names on screen:  superadmin = "Admin",  admin = "Teacher",  user = "Student"
-- (the values stored in the database stay superadmin / admin / user)
-- ============================================================================

-- ---------- 1. files: documents only, one per requirement, check results ----
alter table public.submissions add column if not exists progress int;
alter table public.submissions add column if not exists analysis jsonb;

alter table public.submissions drop constraint if exists submissions_progress_check;
alter table public.submissions add  constraint submissions_progress_check
  check (progress is null or progress between 0 and 100);

alter table public.submissions drop constraint if exists submissions_analysis_size;
alter table public.submissions add  constraint submissions_analysis_size
  check (analysis is null or pg_column_size(analysis) < 40000);

-- new rows may only be pdf / pptx / docx (older rows are left alone)
alter table public.submissions drop constraint if exists submissions_file_kind_check;
alter table public.submissions add  constraint submissions_file_kind_check
  check (file_kind in ('pdf','pptx','docx')) not valid;

-- ONE file per student per requirement (Capstone / Thesis)
do $$
begin
  create unique index if not exists submissions_one_per_requirement
    on public.submissions (user_id, task_id);
exception when unique_violation then
  raise exception 'Some students already have 2 or more files for the same requirement. Open Table Editor -> submissions, delete the extra rows (and their files in Storage), then run this script again.';
end $$;

-- ---------- 2. notifications -----------------------------------------------
create table if not exists public.notifications (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  kind             text not null check (kind in ('registered','uploaded','removed','revision','deleted')),
  audience         text[] not null,          -- roles that may see it: superadmin / admin / user
  student_id       uuid,                      -- the student it is about (kept even if the account is removed)
  actor_id         uuid,                      -- the Admin/Teacher who sent it (null for student activity)
  actor_role       text,
  actor_username   text,
  student_name     text,
  student_username text,
  file_name        text,
  task_id          text,
  message          text not null,
  body             text
);
create index if not exists notifications_created_idx on public.notifications (created_at desc);
create index if not exists notifications_student_idx on public.notifications (student_id);

-- which notices a person already read / removed from their own list
create table if not exists public.notification_state (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  removed         boolean not null default false,
  primary key (user_id, notification_id)
);

alter table public.notifications      enable row level security;
alter table public.notification_state enable row level security;

revoke all on public.notifications from anon;
revoke insert, update, delete on public.notifications from authenticated;
grant  select on public.notifications to authenticated;
revoke all on public.notification_state from anon;
grant  select, insert, update on public.notification_state to authenticated;

-- the role of the logged-in person, but only while their account is active
create or replace function public.my_role()
returns text language sql security definer stable set search_path = public as $$
  select role from public.profiles
  where id = auth.uid() and status in ('active','approved');
$$;

drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select using (
  (actor_id = auth.uid() and public.my_role() in ('admin','superadmin'))   -- what I sent
  or (public.my_role() in ('admin','superadmin') and public.my_role() = any (audience))
  or (public.my_role() = 'user' and 'user' = any (audience) and student_id = auth.uid())
);

drop policy if exists notification_state_own on public.notification_state;
drop policy if exists notification_state_read on public.notification_state;
drop policy if exists notification_state_insert on public.notification_state;
drop policy if exists notification_state_update on public.notification_state;
create policy notification_state_read   on public.notification_state for select using (user_id = auth.uid());
create policy notification_state_insert on public.notification_state for insert with check (user_id = auth.uid());
create policy notification_state_update on public.notification_state for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 3. automatic notices for student activity -----------------------
create or replace function public.notify_registered()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'user' and new.program is not null then
    insert into public.notifications (kind, audience, student_id, student_name, student_username, message)
    values ('registered', '{superadmin,admin}', new.id, new.name, split_part(coalesce(new.email,''), '@', 1),
            new.name || ' (' || new.program || ') registered a new account.');
  end if;
  return new;
end $$;

drop trigger if exists notify_registered on public.profiles;
create trigger notify_registered after insert on public.profiles
  for each row execute function public.notify_registered();

create or replace function public.notify_uploaded()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = new.user_id;
  insert into public.notifications (kind, audience, student_id, student_name, student_username, file_name, task_id, message)
  values ('uploaded', '{superadmin,admin}', new.user_id, p.name, split_part(coalesce(p.email,''), '@', 1),
          new.file_name, new.task_id,
          p.name || ' (' || coalesce(p.program,'') || ') uploaded ' || new.file_name || ' to ' ||
          case new.task_id when 'capstone' then 'Capstone Project' else 'Thesis' end || '.');
  return new;
end $$;

drop trigger if exists notify_uploaded on public.submissions;
create trigger notify_uploaded after insert on public.submissions
  for each row execute function public.notify_uploaded();

-- ---------- 4. send a revision notice (Admin / Teacher only) ----------------
create or replace function public.send_revision(p_student uuid, p_body text, p_submission uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  me public.profiles; st public.profiles; sub public.submissions;
  v_body text; v_file text; v_task text; me_user text; st_user text;
begin
  select * into me from public.profiles
   where id = auth.uid() and role in ('admin','superadmin') and status = 'active';
  if not found then raise exception 'Not allowed.'; end if;

  select * into st from public.profiles where id = p_student and role = 'user' and status = 'approved';
  if not found then raise exception 'Student not found.'; end if;

  v_body := trim(coalesce(p_body, ''));
  if length(v_body) < 3 or length(v_body) > 1000 then
    raise exception 'Write a revision note between 3 and 1000 characters.';
  end if;

  if p_submission is not null then
    select * into sub from public.submissions where id = p_submission and user_id = p_student;
    if not found then raise exception 'That file does not belong to this student.'; end if;
    v_file := sub.file_name; v_task := sub.task_id;
  end if;

  me_user := split_part(coalesce(me.email,''), '@', 1);
  st_user := split_part(coalesce(st.email,''), '@', 1);

  -- the student's pop-up
  insert into public.notifications (kind, audience, student_id, actor_id, actor_role, actor_username,
                                    student_name, student_username, file_name, task_id, message, body)
  values ('revision', '{user}', st.id, me.id, me.role, me_user, st.name, st_user, v_file, v_task,
          'Revision notice from ' || me_user, v_body);

  -- the Admin's log (the sender also sees it through actor_id)
  insert into public.notifications (kind, audience, student_id, actor_id, actor_role, actor_username,
                                    student_name, student_username, file_name, task_id, message, body)
  values ('revision', '{superadmin}', st.id, me.id, me.role, me_user, st.name, st_user, v_file, v_task,
          'Revision Notice Sent “' || left(v_body, 80) || case when length(v_body) > 80 then '…' else '' end ||
          '” to ' || st.name, v_body);
end $$;

-- ---------- 5. remove a file ------------------------------------------------
-- A student removes their OWN file; an Admin/Teacher deletes any file but must
-- leave a note. Returns the storage path so the site can delete the stored copy.
create or replace function public.remove_submission(p_id uuid, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  sub public.submissions; me public.profiles; st public.profiles;
  v_note text; me_user text; st_user text; tname text;
begin
  select * into sub from public.submissions where id = p_id;
  if not found then raise exception 'File not found.'; end if;
  select * into st from public.profiles where id = sub.user_id;
  select * into me from public.profiles where id = auth.uid();
  if not found then raise exception 'Not allowed.'; end if;

  tname   := case sub.task_id when 'capstone' then 'Capstone Project' else 'Thesis' end;
  st_user := split_part(coalesce(st.email,''), '@', 1);
  me_user := split_part(coalesce(me.email,''), '@', 1);

  if me.id = sub.user_id and me.status = 'approved' then
    delete from public.submissions where id = p_id;
    insert into public.notifications (kind, audience, student_id, student_name, student_username, file_name, task_id, message)
    values ('removed', '{superadmin,admin}', st.id, st.name, st_user, sub.file_name, sub.task_id,
            st.name || ' (' || coalesce(st.program,'') || ') removed ' || sub.file_name || ' from ' || tname || '.');

  elsif me.role in ('admin','superadmin') and me.status = 'active' then
    v_note := trim(coalesce(p_note, ''));
    if length(v_note) < 3 or length(v_note) > 1000 then
      raise exception 'Write a revision note (3 to 1000 characters) explaining why the file was deleted.';
    end if;
    delete from public.submissions where id = p_id;
    insert into public.notifications (kind, audience, student_id, actor_id, actor_role, actor_username,
                                      student_name, student_username, file_name, task_id, message, body)
    values ('deleted', '{user}', st.id, me.id, me.role, me_user, st.name, st_user, sub.file_name, sub.task_id,
            'File deleted by ' || me_user, v_note),
           ('deleted', '{superadmin}', st.id, me.id, me.role, me_user, st.name, st_user, sub.file_name, sub.task_id,
            'File deleted: ' || sub.file_name || ' (' || st.name || ') — “' || left(v_note, 80) ||
            case when length(v_note) > 80 then '…' else '' end || '”', v_note);
  else
    raise exception 'Not allowed.';
  end if;

  return sub.storage_path;
end $$;

revoke all on function public.send_revision(uuid, text, uuid) from public, anon;
revoke all on function public.remove_submission(uuid, text)   from public, anon;
grant execute on function public.send_revision(uuid, text, uuid) to authenticated;
grant execute on function public.remove_submission(uuid, text)   to authenticated;

-- ---------- 6. storage rules ------------------------------------------------
drop policy if exists "submissions upload"  on storage.objects;
drop policy if exists "submissions cleanup" on storage.objects;
drop policy if exists "submissions remove"  on storage.objects;

-- upload only into your own folder, only a PDF / Word / PowerPoint file name,
-- and only once you are approved with at least one unlocked requirement
create policy "submissions upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'submissions'
  and (storage.foldername(name))[1] = auth.uid()::text
  and lower(name) ~ '\.(pdf|docx?|pptx?)$'
  and exists (select 1 from public.profiles p
              where p.id = auth.uid() and p.status = 'approved'
                and cardinality(p.unlocked_tasks) > 0)
);

-- delete your own stored files; Admin/Teacher can delete any
create policy "submissions remove" on storage.objects for delete to authenticated using (
  bucket_id = 'submissions'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff())
);

-- Opening a file: your own folder, Admin/Teacher, or a file whose record you are
-- allowed to see (approved classmates in your course). Your own folder must stay
-- readable even after the record is gone, otherwise the stored copy of a removed
-- file could never be deleted.
drop policy if exists "submissions read" on storage.objects;
create policy "submissions read" on storage.objects for select to authenticated using (
  bucket_id = 'submissions'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_staff()
    or exists (select 1 from public.submissions s where s.storage_path = name)
  )
);

-- Check: should list the tables and functions added above
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('notifications','notification_state') order by 1;
