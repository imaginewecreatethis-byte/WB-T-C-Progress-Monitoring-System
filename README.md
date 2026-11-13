# WB-T&C Progress Monitoring System

A role-based portal for Capstone/Thesis requirement tracking across
BSIT, DIT, BSIE and BSBA. Students upload their files online, an Admin
reviews them, and approved students can see and open the files their
classmates submitted in the **same course**.

## Update 3 features
- **Email login:** sign in and register with any email (Gmail etc.). Old-style usernames still work and mean `username@pup.edu.ph`. Emails are not verified (Confirm email is off), so approve students only when you recognise them.
- **Manage Students:** one collapsible row per student (no more overlap). Click a row to see requirements, tags and files.
- **Gallery (Teacher/Admin):** one folder per student with file count, completed count, tags and last update date.
- **Delete Student (Teacher or Admin) / Delete Teacher (Admin):** trash icon, popup with a 5-second wait. Removes the account, files and progress. The Admin's Recently Deleted button lists who was deleted, by whom and when (a record only, nothing can be restored).
- **Release Clearance:** you can also type names by hand (+ / -). Typed names are added to the letter and PDF; only ticked students (who have accounts) get the message.
- **Renamed logins:** Admin is now `cecilia.nacpil` (Cecilia Q. Nacpil) and Teacher is `zedrick.reyes` (Mr. Zedrick Duane M. Reyes). Passwords are unchanged.

## Update 2 features
- **Idle timeout:** Student 1 h 30 min, Teacher and Admin 30 min. The session is closed and a notice is shown; they can log in again. The notice is a message only (nothing extra is stored).
- **Release Clearance (Admin only):** Admin > All Students > Release Clearance. Tick approved students, preview the letter, Download (PDF) and Done. Done sends each student the clearance message.
- **Frontpage Book and Certification Panel Examiners:** one image each (jpg/png/webp, up to 5 MB) per student; Teachers can lock/unlock them like the other requirements.
- **Input filters:** `( ) { } / | " & ^ % # @ !` and hateful/violent words (including look-alikes such as H1tler) are blocked in usernames, passwords and revision notes. Usernames and notes are also enforced in the database; passwords can only be filtered in the browser. Existing passwords that contain a blocked symbol must be reset.
- **Viewer:** View file shows PDFs, images, .docx and .pptx inside the site. Charts and animations are not shown, and old .doc/.ppt files cannot be previewed (download them instead).

## File structure
```
├─ assets/            icons, PUP seal, campus photo
├─ pages/             userpage.html, adminpage.html, superadminpage.html
├─ src/               script.js (UI + routing), analyzer.js (document check), style.css
├─ supabase/          2-upgrade.sql (rules and starting accounts), 3-update.sql (notices, one file per requirement), 4-update.sql (image requirements, clearance, filters)
├─ index.html         sign in / register
├─ db.js              data layer (Supabase)
└─ CNAME              custom domain for GitHub Pages
```
