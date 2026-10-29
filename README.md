# WB-T&C Progress Monitoring System

A role-based portal for Capstone/Thesis requirement tracking across
BSIT, DIT, BSIE and BSBA. Students upload their files online, an Admin
reviews them, and approved students can see and open the files their
classmates submitted in the **same course**.

## How it works
- **Website** (this repo): plain HTML/CSS/JavaScript, hosted on GitHub Pages
  and served from your custom domain (see `CNAME`).
- **Backend**: a free [Supabase](https://supabase.com) project that provides
  - **Auth**: real accounts with hashed passwords and sessions
  - **Postgres database**: `profiles` and `submissions` tables
  - **Storage**: a private `submissions` bucket that holds the uploaded files
- `db.js` is the only file that talks to Supabase. `src/script.js` draws the pages.

## Roles
The names on screen changed. The database still stores `user` / `admin` / `superadmin`.

| On screen | Can do |
|---|---|
| **Student** | Register, wait for approval, upload ONE PDF / Word / PowerPoint file per unlocked requirement (no images), remove it, see the automatic progress %, layout and grammar review, read revision notices, open approved classmates' files in the same course |
| **Teacher** | Approve/reject registrations, unlock or lock requirements, add tags, see every file with its progress %, download, delete a file with a note, send revision notices |
| **Admin** | Everything a Teacher can, plus create/deactivate Teacher accounts and see every Teacher's revision notices |

## Notifications and revision notices
- Admin and Teacher are notified when a student registers, uploads or removes a file. Admin also sees every revision notice a Teacher sends.
- A Student gets a pop-up for each revision notice or file deletion, and finds it again under **Notifications**.
- Everyone can remove notices from their own list (this does not delete it for anyone else).

## Automatic document check (in the browser)
On upload the browser reads the file and saves a progress %, and layout/grammar results, with it.
- Progress = how many of 9 sections are found (Abstract, Introduction, Problem/Objectives, Scope, Related Literature, Methodology, Results, Conclusion, References). A very short section counts half. 100% shows a "completed" tag.
- Layout: fonts, sizes, headings, page numbers, blank pages (PowerPoint: titles, crowded slides, text size).
- Grammar: common spelling slips, repeated words, a/an, agreement, capitals, spacing.
- Limits: it is rule-based, so it can miss things or flag correct writing. Scanned PDFs and old .doc/.ppt files can't be read, so they get no score. Because the check runs on the student's device, a tampered browser could fake a score.

## One account per person
- A username (`name@pup.edu.ph`) can only be used once (enforced by Supabase Auth).
- The same name in the same course can only register once (enforced by a unique index in the database).
- A browser remembers the account it created and refuses to create a second one. This part is a
  deterrent only: a different browser or cleared site data gets around it, which is why the
  first two rules are enforced on the server.

## Security notes
- The Supabase URL and `anon` key in `db.js` are **meant to be public**. What protects the data is
  Row Level Security, defined in `supabase/2-upgrade.sql`. Never put the `service_role` / secret key
  in this repo.
- Students can only upload for themselves, only once approved, and only to a requirement an Admin
  unlocked. Only a Super Admin can change roles.
- Uploaded files are opened through temporary (5-minute) links.
- **Change the default Super Admin and Admin passwords after the site goes live** (see below).

## Setting up Supabase (one time)
1. Create a Supabase project and a **private** storage bucket named `submissions`.
2. Run the table-creation SQL (creates `profiles` and `submissions`).
3. Run `supabase/2-upgrade.sql` in **SQL Editor → New query**. It adds the security rules, the
   duplicate-account protection, and creates the starting Super Admin and Admin accounts.
4. **Authentication → Sign In / Providers → Email**: turn **Confirm email** off, so students can
   sign in as soon as they register (the Admin approval step is the gatekeeper).
5. Run `supabase/3-update.sql` the same way (notifications, revision notices, one file per requirement, document-only uploads). It is safe to run again.
6. Put your project URL and `anon` key at the top of `db.js`.

### Changing a password
In Supabase: **Authentication → Users →** the account **→ Send password recovery / Reset password**,
or run in the SQL Editor:
```sql
update auth.users set encrypted_password = extensions.crypt('NEW-PASSWORD', extensions.gen_salt('bf'))
where email = 'santos@pup.edu.ph';
```

## File structure
```
├─ assets/            icons, PUP seal, campus photo
├─ pages/             userpage.html, adminpage.html, superadminpage.html
├─ src/               script.js (UI + routing), analyzer.js (document check), style.css
├─ supabase/          2-upgrade.sql (rules and starting accounts), 3-update.sql (notices, one file per requirement)
├─ index.html         sign in / register
├─ db.js              data layer (Supabase)
└─ CNAME              custom domain for GitHub Pages
```

## Running locally
Serve the folder with any static server (for example `npx serve .`) and open `index.html`.
Opening the file directly by double-click also works for most browsers.

## Free-tier limits to know about
- Supabase free plan: 500 MB database, **1 GB file storage**, 5 GB bandwidth per month.
  At the 10 MB per-file limit that is roughly 100+ full-size files, and far more for typical PDFs.
- A free Supabase project **pauses after 1 week without activity**. Opening the site once
  or pressing "Restore" in the Supabase dashboard wakes it up.
