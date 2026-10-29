# WB-T&C Progress Monitoring System

A role-based portal for Capstone/Thesis requirement tracking across
BSIT, DIT, BSIE and BSBA. Students upload their files online, an Admin
reviews them, and approved students can see and open the files their
classmates submitted in the **same course**.


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

## Free-tier limits to know about
- Supabase free plan: 500 MB database, **1 GB file storage**, 5 GB bandwidth per month.
  At the 10 MB per-file limit that is roughly 100+ full-size files, and far more for typical PDFs.
- A free Supabase project **pauses after 1 week without activity**. Opening the site once
  or pressing "Restore" in the Supabase dashboard wakes it up.
