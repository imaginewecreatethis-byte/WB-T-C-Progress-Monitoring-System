# WB-T&C Progress Monitoring System

A role-based portal for Capstone/Thesis requirement tracking across
BSIT, DIT, BSIE and BSBA. Students upload their files online, an Admin
reviews them, and approved students can see and open the files their
classmates submitted in the **same course**.

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

