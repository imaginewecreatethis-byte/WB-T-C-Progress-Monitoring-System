-- ============================================================================
-- WB-T&C  —  Supabase update #7   (run ONCE in SQL Editor -> New query)
-- Run AFTER 2 ... 6-update.sql. Safe to run again.
--
-- Adds "Send Teacher Request" for students who forgot their password:
--   * the student picks a Teacher and sends Student ID, Full name, Course and
--     the new password they want (the password is stored only as a hash)
--   * the chosen Teacher (and the Admin) see the request, tick what matches
--     their records, and accept it -> the password is changed
-- ============================================================================

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('registered','uploaded','removed','revision','deleted','clearance','pwrequest'));

create table if not exists public.password_requests (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  username        text not null,
  email           text not null,
  student_no      text not null,
  full_name       text not null,
  course          text not null,
  teacher_id      uuid not null references public.profiles(id) on delete cascade,
  new_hash        text not null,
  status          text not null default 'pending' check (status in ('pending','accepted','declined')),
  decided_at      timestamptz,
  decided_by_name text,
  checks_ok       int
);
create index if not exists password_requests_teacher_idx on public.password_requests (teacher_id, status);
alter table public.password_requests enable row level security;
drop policy if exists "pwreq read" on public.password_requests;
create policy "pwreq read" on public.password_requests for select to authenticated
  using ((teacher_id = auth.uid() and public.my_role() = 'admin') or public.is_superadmin());
revoke all on public.password_requests from anon, authenticated;
grant select (id, created_at, user_id, username, email, student_no, full_name, course, teacher_id, status, decided_at, decided_by_name, checks_ok)
  on public.password_requests to authenticated;

create or replace function public.available_teachers()
returns table (id uuid, name text) language sql stable security definer set search_path = public as $$
  select p.id, p.name from public.profiles p
   where p.role = 'admin' and p.status = 'active' order by p.name;
$$;
revoke all on function public.available_teachers() from public;
grant execute on function public.available_teachers() to anon, authenticated;

create or replace function public.request_password_change(
  p_email text, p_new_password text, p_student_no text, p_full_name text, p_course text, p_teacher uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  st public.profiles; t public.profiles; uname text; r_id uuid;
begin
  select * into st from public.profiles where lower(email) = lower(trim(coalesce(p_email,''))) and role = 'user';
  if not found then raise exception 'Email is not found.'; end if;
  select * into t from public.profiles where id = p_teacher and role = 'admin' and status = 'active';
  if not found then raise exception 'Please choose an available teacher.'; end if;

  if p_new_password is null or length(p_new_password) < 6 or length(p_new_password) > 64
     or public.text_problem(p_new_password) is not null then
    raise exception 'That password is not allowed (6-64 characters, no blocked symbols).';
  end if;
  if coalesce(p_student_no,'') !~ '^[A-Za-z0-9-]{4,25}$' then
    raise exception 'Student ID may only have letters, numbers and dashes (4-25 characters).';
  end if;
  if length(trim(coalesce(p_full_name,''))) < 2 or length(p_full_name) > 80 or public.text_problem(p_full_name) is not null then
    raise exception 'Please type your full name.';
  end if;
  if length(trim(coalesce(p_course,''))) < 2 or length(p_course) > 40 or public.text_problem(p_course) is not null then
    raise exception 'Please type your course.';
  end if;
  if exists (select 1 from public.password_requests where user_id = st.id and status = 'pending'
              and created_at > now() - interval '7 days') then
    raise exception 'You already sent a request. Please wait for your teacher.';
  end if;

  uname := split_part(coalesce(st.email,''), '@', 1);
  insert into public.password_requests (user_id, username, email, student_no, full_name, course, teacher_id, new_hash)
  values (st.id, uname, st.email, trim(p_student_no), trim(p_full_name), trim(p_course), t.id,
          extensions.crypt(p_new_password, extensions.gen_salt('bf')))
  returning id into r_id;

  insert into public.notifications (kind, audience, student_id, student_name, student_username, message, body)
  values ('pwrequest', '{superadmin}', st.id, st.name, uname,
          uname || ' requested a password change (sent to ' || t.name || ').', null);
  insert into public.notifications (kind, audience, student_id, actor_id, actor_role, student_name, student_username, message, body)
  values ('pwrequest', '{}', st.id, t.id, 'admin', st.name, uname,
          uname || ' requested a password change. Open Password Requests to review it.', null);
end $$;
revoke all on function public.request_password_change(text,text,text,text,text,uuid) from public;
grant execute on function public.request_password_change(text,text,text,text,text,uuid) to anon, authenticated;

create or replace function public.decide_password_request(p_id uuid, p_accept boolean, p_checks int)
returns table (username text, email text) language plpgsql security definer set search_path = public as $$
declare
  me public.profiles; r public.password_requests;
begin
  select * into me from public.profiles where id = auth.uid() and role in ('admin','superadmin') and status = 'active';
  if not found then raise exception 'Not allowed.'; end if;
  select * into r from public.password_requests where id = p_id and status = 'pending';
  if not found then raise exception 'This request was already handled.'; end if;
  if me.role = 'admin' and r.teacher_id <> me.id then raise exception 'Not allowed.'; end if;

  if p_accept then
    if coalesce(p_checks, 0) < 2 then raise exception 'Tick at least 2 items that match first.'; end if;
    update auth.users set encrypted_password = r.new_hash, updated_at = now() where id = r.user_id;
    delete from auth.sessions where user_id = r.user_id;
  end if;
  update public.password_requests
     set status = case when p_accept then 'accepted' else 'declined' end,
         decided_at = now(), decided_by_name = me.name, checks_ok = p_checks, new_hash = ''
   where id = r.id;
  return query select r.username, r.email;
end $$;
revoke all on function public.decide_password_request(uuid, boolean, int) from public, anon;
grant execute on function public.decide_password_request(uuid, boolean, int) to authenticated;

select 'update 7 installed' as result;
