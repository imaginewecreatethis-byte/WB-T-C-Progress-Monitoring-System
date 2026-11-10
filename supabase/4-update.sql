-- ============================================================================
-- WB-T&C  —  Supabase update #4   (run ONCE in SQL Editor -> New query)
--
-- Run this AFTER 2-upgrade.sql and 3-update.sql. Safe to run again.
--
-- Adds:
--   * Two image-only requirements per student: "Frontpage Book" and
--     "Certification Panel Examiners" (one image each, Teacher can lock/unlock)
--   * Release Clearance (Admin only) -> every chosen student gets a message
--   * A word / symbol filter that is also enforced here, so it cannot be
--     skipped from the browser (usernames and revision notes)
-- ============================================================================

-- ---------- 1. new requirements and the image file type ----------------------
alter table public.submissions drop constraint if exists submissions_task_id_check;
alter table public.submissions add  constraint submissions_task_id_check
  check (task_id in ('capstone','thesis','frontpage','certification'));

alter table public.submissions drop constraint if exists submissions_file_kind_check;
alter table public.submissions add  constraint submissions_file_kind_check
  check (file_kind in ('pdf','pptx','docx','image')) not valid;

-- images belong only to the two image requirements, documents only to the rest
alter table public.submissions drop constraint if exists submissions_kind_matches_task;
alter table public.submissions add  constraint submissions_kind_matches_task
  check ((task_id in ('frontpage','certification')) = (file_kind = 'image')) not valid;

create or replace function public.task_title(t text)
returns text language sql immutable as $$
  select case t when 'capstone'      then 'Capstone Project'
                when 'thesis'        then 'Thesis'
                when 'frontpage'     then 'Frontpage Book'
                when 'certification' then 'Certification Panel Examiners'
                else t end;
$$;

-- storage: also allow image file names (jpg / png / webp)
drop policy if exists "submissions upload" on storage.objects;
create policy "submissions upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'submissions'
  and (storage.foldername(name))[1] = auth.uid()::text
  and lower(name) ~ '\.(pdf|docx?|pptx?|jpe?g|png|webp)$'
  and exists (select 1 from public.profiles p
              where p.id = auth.uid() and p.status = 'approved'
                and cardinality(p.unlocked_tasks) > 0)
);

-- ---------- 2. word / symbol filter ------------------------------------------
-- Returns NULL when the text is fine, otherwise a short reason.
--   * symbols not allowed:  ( ) { } / | " & ^ % # @ !
--   * look-alike spellings are caught (H1tl3r, J3ws, n1gg3r ...)
create or replace function public.text_problem(p text)
returns text language plpgsql immutable as $$
declare
  norm text; letters text; tok text;
  contains_list text[] := array['hitler','epstein','nigger','faggot'];
  token_list    text[] := array['jew','jews','nazi','nazis','kkk','nigga','nigger','fag','faggot',
                                'retard','retarded','kike','spic','chink','coon','cunt','whore','slut',
                                'murder','rape','rapist','terrorist','kys'];
  w text;
begin
  if p is null then return null; end if;
  if p ~ '[(){}/|"&^%#@!]' then
    return 'These characters are not allowed: ( ) { } / | " & ^ % # @ !';
  end if;
  norm := translate(lower(p), '1!34@05$7+', 'iieaaosstt');
  letters := regexp_replace(norm, '[^a-z]', '', 'g');
  foreach w in array contains_list loop
    if position(w in letters) > 0 then return 'That wording is not allowed.'; end if;
  end loop;
  foreach tok in array regexp_split_to_array(norm, '[^a-z]+') loop
    if tok = any (token_list) then return 'That wording is not allowed.'; end if;
  end loop;
  return null;
end $$;

-- usernames: the part before @ is checked when an account is created
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := left(regexp_replace(trim(coalesce(new.raw_user_meta_data->>'name','')), '\s+', ' ', 'g'), 60);
  v_prog text := new.raw_user_meta_data->>'program';
begin
  if public.text_problem(split_part(coalesce(new.email,''), '@', 1)) is not null then
    raise exception 'That username is not allowed.';
  end if;
  insert into public.profiles (id, email, name, program)
  values (
    new.id, lower(new.email),
    coalesce(nullif(v_name, ''), split_part(new.email, '@', 1)),
    case when v_prog in ('BSIT','DIT','BSIE','BSBA') then v_prog else null end
  );
  return new;   -- role is ALWAYS 'user' and status ALWAYS 'pending' here
end $$;

-- ---------- 3. notices: new kind, new task names, filter on notes -------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add  constraint notifications_kind_check
  check (kind in ('registered','uploaded','removed','revision','deleted','clearance'));

create or replace function public.notify_uploaded()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = new.user_id;
  insert into public.notifications (kind, audience, student_id, student_name, student_username, file_name, task_id, message)
  values ('uploaded', '{superadmin,admin}', new.user_id, p.name, split_part(coalesce(p.email,''), '@', 1),
          new.file_name, new.task_id,
          p.name || ' (' || coalesce(p.program,'') || ') uploaded ' || new.file_name || ' to ' ||
          public.task_title(new.task_id) || '.');
  return new;
end $$;

create or replace function public.send_revision(p_student uuid, p_body text, p_submission uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  me public.profiles; st public.profiles; sub public.submissions;
  v_body text; v_file text; v_task text; me_user text; st_user text; v_bad text;
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
  v_bad := public.text_problem(v_body);
  if v_bad is not null then raise exception '%', v_bad; end if;

  if p_submission is not null then
    select * into sub from public.submissions where id = p_submission and user_id = p_student;
    if not found then raise exception 'That file does not belong to this student.'; end if;
    v_file := sub.file_name; v_task := sub.task_id;
  end if;

  me_user := split_part(coalesce(me.email,''), '@', 1);
  st_user := split_part(coalesce(st.email,''), '@', 1);

  insert into public.notifications (kind, audience, student_id, actor_id, actor_role, actor_username,
                                    student_name, student_username, file_name, task_id, message, body)
  values ('revision', '{user}', st.id, me.id, me.role, me_user, st.name, st_user, v_file, v_task,
          'Revision notice from ' || me_user, v_body);

  insert into public.notifications (kind, audience, student_id, actor_id, actor_role, actor_username,
                                    student_name, student_username, file_name, task_id, message, body)
  values ('revision', '{superadmin}', st.id, me.id, me.role, me_user, st.name, st_user, v_file, v_task,
          'Revision Notice Sent “' || left(v_body, 80) || case when length(v_body) > 80 then '…' else '' end ||
          '” to ' || st.name, v_body);
end $$;

create or replace function public.remove_submission(p_id uuid, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  sub public.submissions; me public.profiles; st public.profiles;
  v_note text; me_user text; st_user text; tname text; v_bad text;
begin
  select * into sub from public.submissions where id = p_id;
  if not found then raise exception 'File not found.'; end if;
  select * into st from public.profiles where id = sub.user_id;
  select * into me from public.profiles where id = auth.uid();
  if not found then raise exception 'Not allowed.'; end if;

  tname   := public.task_title(sub.task_id);
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
    v_bad := public.text_problem(v_note);
    if v_bad is not null then raise exception '%', v_bad; end if;
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

-- ---------- 4. Release Clearance (Admin only) ---------------------------------
create or replace function public.release_clearance(p_students uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare
  me public.profiles; st public.profiles; me_user text; n int := 0; names text[] := '{}';
  msg text := E'The clearance has been accepted. Congratulations, you did well, and I hope you have a brighter future.\n\n' ||
              E'I hope you did your best, and that others try their best too. After these 3 years you will realize how far you have come, and your journey keeps moving forward. I wish you well. Thank you.';
begin
  select * into me from public.profiles where id = auth.uid() and role = 'superadmin' and status = 'active';
  if not found then raise exception 'Not allowed.'; end if;
  if p_students is null or cardinality(p_students) = 0 then raise exception 'Choose at least one student.'; end if;
  if cardinality(p_students) > 200 then raise exception 'Too many students at once.'; end if;
  me_user := split_part(coalesce(me.email,''), '@', 1);

  for st in select * from public.profiles
             where id = any (p_students) and role = 'user' and status = 'approved'
             order by name loop
    insert into public.notifications (kind, audience, student_id, actor_id, actor_role, actor_username,
                                      student_name, student_username, message, body)
    values ('clearance', '{user}', st.id, me.id, me.role, me_user, st.name,
            split_part(coalesce(st.email,''), '@', 1), 'Clearance accepted', msg);
    names := names || st.name;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'None of those students can be cleared.'; end if;

  insert into public.notifications (kind, audience, actor_id, actor_role, actor_username, message, body)
  values ('clearance', '{superadmin}', me.id, me.role, me_user,
          'Clearance released to ' || n || ' student' || case when n = 1 then '' else 's' end ||
          ': ' || left(array_to_string(names, ', '), 120), array_to_string(names, E'\n'));
  return n;
end $$;

revoke all on function public.release_clearance(uuid[]) from public, anon;
grant execute on function public.release_clearance(uuid[]) to authenticated;
revoke all on function public.text_problem(text) from public, anon;
grant execute on function public.text_problem(text) to authenticated;

-- Check: should list the two new requirement names
select public.task_title('frontpage') as a, public.task_title('certification') as b;
