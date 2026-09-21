# WB-T&C Progress Monitoring System

A role-based portal for Capstone/Thesis requirement tracking across
BSIT, DIT, BSIE and BSBA.

## File structure
```
WB-T&C Progress Monitoring System/
├─ assets/
│  └─ icons.js         shared inline-SVG icon set
├─ pages/
│  ├─ adminpage.html    Admin console
│  ├─ superadminpage.html  Super Admin console
│  └─ userpage.html     Student/User dashboard
├─ src/
│  ├─ script.js         shared UI logic, routing guards, page renderers
│  └─ style.css         shared design system (tokens, layout, components)
├─ index.html           sign in / register
└─ db.js                data layer — the "backend" (localStorage-persisted)
```

## Run it
No build step or server required — just open `index.html` in a browser
(double-click it, or serve the folder with any static server, e.g.
`npx serve .`).

## Demo accounts
Click any of the three demo chips on the sign-in screen to autofill:

| Role         | Email                  | Password  |
|--------------|------------------------|-----------|
| Super Admin  | santos@pup.edu.ph      | super123  |
| Admin        | reyes@pup.edu.ph       | admin123  |
| User         | juan@pup.edu.ph        | user123   |

## Data & storage
This is a front-end prototype. `db.js` persists the student/admin
records to `localStorage` (key `wbtc-portal-db-v1`). **Uploaded
files are now stored for real** — not just their name: each file is
read as a base64 data URL and saved under its own `localStorage` key
(`wbtc-file:<id>`), separate from the main record, so approving a
student or toggling a lock never has to re-save file bytes along
with it. Only the file's metadata (id, name, type, size, date) lives
inside the student's record.

Because this has no real server, uploads are validated and capped
client-side (`db.js` → `validateUploadFile`): file extension is
checked against PDF/PPT(X)/XLS(X), cross-checked against the
browser-reported MIME type when available (so a `.jpg` renamed to
`.pdf` is rejected), and capped at 2MB per file — `localStorage` only
holds a few MB per browser total. Every uploaded file gets a small
"view/download" button (the down-arrow icon next to its name) that
opens the stored file in a new tab — visible to both the student who
uploaded it and the Admin reviewing it. Records seeded before this
existed (or ones from an even older version of this app) show a
graceful "no file data stored" message instead of erroring.

There are no external API calls or keys anywhere in this codebase —
everything runs against the browser's own storage, so there's
nothing that could leak. If you eventually connect a real backend,
route any third-party API calls through a server you control rather
than calling them directly from this front-end code, since anything
here is visible to whoever opens the page.

## New in this version
- **Dashboards redesigned as a dense panel grid** — reworked User,
  Admin, and Super Admin around a reusable panel system (icon-badge
  header bar + body), inspired by BI/reporting dashboard layouts:
  zebra-striped tables, color-coded status pills, and compact stat
  panels replacing the old loosely-spaced cards. Applied consistently
  across every tab — Course Projects, Manage Students, New
  Registrations, Admin Accounts, Student Progress, Notifications, and
  Gallery all use the same building blocks now, so the whole app
  reads as one coherent system instead of one-off page layouts.
- **Fixed a real regression caught during testing** — while
  restructuring Admin's "New Registrations" tab, the Approve button's
  click handler got dropped (Reject still worked, Approve silently
  did nothing). Caught this by testing the actual click path end to
  end, not just checking that the page rendered — fixed and
  re-verified.
- **Fixed the login page's lopsided empty margin** — the previous
  max-width fix centered the panel using a fixed width cap, which
  looked fine at some viewport sizes but created an uneven gap at
  others. Replaced it: the layout now fills the full width at every
  size, and the form itself grows moderately wider on large screens
  (via `clamp()`) instead of the whole container shrinking to make
  room for empty margins.
- **Real mobile/tablet/desktop tiers, not one blunt breakpoint** —
  the login page previously had a single stack-or-don't breakpoint.
  Now: phones get tightened spacing and smaller type, tablets get a
  shorter header-style brand panel, desktop gets the full two-column
  layout — each tier tuned on its own rather than guessed from one
  cutoff.
- **Fixed the same asymmetric-gap bug on every dashboard** — the
  content area was width-capped but left-aligned next to the
  sidebar, dumping all the leftover space on the right only. It's
  now centered within the available area so any leftover space
  splits evenly instead of pooling on one side.
- **Security & quality pass:**
  - **No exposed keys** — audited the whole project; there are none.
    Added `.gitignore` so a future `.env` can never get committed.
    Before pushing anywhere, run `grep -rni "key\|secret\|token" .`
    yourself and check every hit.
  - **Broken authentication, fixed** — found a real gap: deactivating
    an Admin who was already logged in didn't actually end their
    session; they kept access until they logged out themselves. The
    route guard now checks account status on every page load, not
    just at sign-in, and force-logs-out immediately if it's inactive.
    Also hardened against the "log out, then hit Back" bypass some
    browsers allow via page caching. Tested directly: unauthenticated
    access to every protected page, wrong-role access, a forged
    session value, and the deactivated-admin case all correctly
    redirect/reject.
  - **Input validation, both layers** — name, username, password, and
    tag fields are now validated for length and character set, with
    matching `maxlength` attributes in the UI. Critically, the
    validation lives in `db.js` itself (not just the form), so bad
    data can't reach storage even if the UI check were bypassed some
    other way. Confirmed directly: `<script>` tags and other
    injection attempts in name/tag fields are rejected before they
    ever touch a record.
  - **Solid colors, not gradients** — audited every gradient in the
    stylesheet. Found no decorative gradient fills on buttons, cards,
    or headers. What remained: two pattern-drawing tricks (the faint
    grid lines and perforated dots use gradient syntax to draw hard
    edges, not to blend colors — they don't look like gradients),
    the skeleton-loading shimmer (structurally needs a moving
    gradient to animate at all), and one genuine 3-stop color
    gradient — the dark scrim over the login page's campus photo —
    which is now flattened to a single solid tint.
  - **Unfilled space on the login page** — on wide screens, the
    50/50 layout left the form looking lost in a sea of empty space
    on the right half. The whole panel now caps at a sane max-width
    and centers itself, with the page's existing background color
    filling the margins intentionally instead of looking cut off.
- **Gallery now on the User dashboard too** — students get the same
  library view of their own submitted files, scoped automatically to
  their own course (no course filter needed since it's always
  theirs), with a project-type filter and search. Lives right next
  to "Course Projects" in the sidebar.
- **Gallery (Admin & Super Admin)** — a library-style view of every
  submitted Capstone/Thesis file across all students, with filters
  for course (BSIT/DIT/BSIE/BSBA), project type, and a search box.
  Each entry is a small index-card showing the file type, name,
  student, course, and a view/download button. Admin's copy lets
  them act on things elsewhere in the app; Super Admin's is the same
  read-only library for oversight.
- **PUP branding** — the sidebar and login screen now show the real
  Polytechnic University of the Philippines seal instead of a generic
  icon, and the login page's left panel now has the PUP Bataan Branch
  campus photo as a background (behind a dark scrim so the text stays
  readable, with the existing ledger-grid texture layered on top).
- **Fixed invisible Log out button** — on the dark sidebar it was
  rendering near-black text on a near-black background (only the
  faint border was visible). Now it's properly white-on-dark at
  every screen size.
- **Hamburger menu on smaller screens** — below ~880px wide, the
  sidebar no longer squeezes nav links into a horizontally-scrolling
  strip. It collapses to a slim bar with a three-line menu button;
  tapping it drops down the full nav + your profile/Log out, and it
  closes again automatically once you pick a section.
- **Editable course/program** — Admin can now change a student's
  program directly from a dropdown (BSIT/DIT/BSIE/BSBA) shown right
  on their card, in both "New Registrations" and "Manage Students."
  Changing it updates their program tag and re-tags every one of
  their course projects to match.
- **Sidebar layout** — all three dashboards (User/Admin/Super Admin)
  now use a persistent left sidebar for navigation instead of top
  tabs: brand, nav links with badge counts, and your profile + Log
  out pinned at the bottom. A slim topbar shows the current section
  title. On narrow screens the sidebar collapses into a single
  horizontal bar. Content now uses the freed-up width, and Admin's
  student list and pending-registration queue display as a
  responsive two-up card grid instead of one long single column.
- **User dashboard two-column top section** — quick stats and your
  program/profile card now sit side by side instead of stacked full
  width.
- **Sign In now uses the same PUP-email compose field** as Register and
  "Add Admin" — type your username, the `@pup.edu.ph` badge is fixed
  alongside it. Demo chips fill in the username only.
- **Loading feedback on sign-in** — the button shows a small spinner
  and "Signing in…" for a moment before handing off to your dashboard.
- **Skeleton loading** — each dashboard (User/Admin/Super Admin) shows
  a brief shimmering placeholder layout the instant the page opens,
  before the real content swaps in.
- **Simpler click animation** — dashboard content now fades in once
  per screen instead of once per card, so switching tabs (Admin
  Accounts/Notifications/Student Progress/New Registrations, etc.)
  feels calmer. Nav tabs also got a small, subtle press state.
- **Friendlier, more responsive dashboards** — cards lift slightly on
  hover, the header stacks cleanly on narrow phones, and quick-stats
  reflow to two columns on small screens.
- **Admin can now see what students actually uploaded** — "Manage
  Students" lists each Course Project's submitted files (name + date)
  under its lock/unlock control, not just the toggle. The User
  dashboard's "Requirements" section is now labeled "Course Projects"
  to match, with "Course:" replacing "Tag:" on each task.
- **PUP email everywhere** — Register and "Add Admin" only ask for a
  username; `@pup.edu.ph` is appended automatically (`db.js` →
  `DB.composeEmail()`).
- **Show/hide password** — every password field has an eye toggle
  (`.pw-toggle` in `src/script.js`, `.password-wrap` in `src/style.css`).
- **Cookie-simulated privacy consent** — a checkbox on the sign-in
  screen gates both Sign In and Register until it's checked. Checking
  it sets a real browser cookie (`wbtc_consent`, 365 days) so returning
  visitors don't have to check it again. "View Policy" opens a short
  in-page modal explaining what's stored and why.
- **Friendlier dashboards** — each role now opens on a short greeting
  and a row of quick-glance stats (e.g. Unlocked/Locked/Files for
  students, Pending/Approved/Files for Admin, Active Admins/Students/
  Pending for Super Admin). Admin's "Manage Students" and Super Admin's
  "Student Progress" both got a search box to filter long lists.
- **Simpler animation** — dashboard cards now use a single plain fade
  instead of the earlier staggered slide-up.

## How the roles connect
- **db.js** is the single source of truth. Every page reads and writes
  through it, so an action taken on `adminpage.html` (approving a
  student, unlocking a task) is visible the next time `userpage.html`
  or `superadminpage.html` loads.
- **User** registers under a program → account starts `pending` and
  view-only. Capstone and Thesis are auto-assigned as required tasks.
- **Admin** approves/rejects registrations, unlocks uploads per task,
  and tags students. Gets a notification (with filed date) for every
  new registration.
- **Super Admin** manages Admin accounts only, and gets a read-only
  view of student progress plus the same registration notifications.

## Data & storage
This is a front-end prototype: `db.js` persists everything to
`localStorage` in the browser (key `wbtc-portal-db-v1`), and file
uploads store the file's name and type only — there's no server to
hold the actual binary. Swap `db.js`'s `load()`/`save()` for real
API calls to connect a genuine backend without touching the pages.
