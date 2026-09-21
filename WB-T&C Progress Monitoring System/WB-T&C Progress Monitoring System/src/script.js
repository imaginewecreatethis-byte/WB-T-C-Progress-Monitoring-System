/* ============================================================================
   script.js — WB-T&C Progress Monitoring System
   Shared front-end logic for index.html, pages/userpage.html,
   pages/adminpage.html, pages/superadminpage.html.
   Reads/writes everything through db.js (window.DB).
   ============================================================================ */
(function () {
  "use strict";

  var I = window.ICONS;
  var D = window.DB;

  // Some browsers restore a page from the back/forward cache (bfcache) on
  // Back/Forward navigation WITHOUT re-running this script — which would let
  // someone log out, hit Back, and see a stale authenticated page that never
  // re-checked the session. Forcing a reload makes the guard run fresh.
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) window.location.reload();
  });

  /* ---------------------------------------------------------------------- */
  /* small dom helpers                                                       */
  /* ---------------------------------------------------------------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pathToRoot() {
    // pages/*.html live one level down from index.html
    return document.body.dataset.depth === "1" ? "../" : "";
  }
  function assetPath(name) {
    return pathToRoot() + "assets/" + name;
  }
  function firstName(fullName) {
    var n = (fullName || "").replace(/^(Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)\s*/i, "");
    var parts = n.split(",");
    return (parts.length > 1 ? parts[1] : parts[0]).trim().split(" ")[0];
  }

  /* ---------------------------------------------------------------------- */
  /* cookie simulation — used to remember the privacy/cookie consent choice  */
  /* ---------------------------------------------------------------------- */
  function setCookie(name, value, days) {
    var expires = "";
    if (days) {
      var d = new Date();
      d.setTime(d.getTime() + days * 86400000);
      expires = "; expires=" + d.toUTCString();
    }
    document.cookie = name + "=" + encodeURIComponent(value) + expires + "; path=/; SameSite=Lax";
  }
  function getCookie(name) {
    var match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : null;
  }
  function deleteCookie(name) { setCookie(name, "", -1); }

  /* ---------------------------------------------------------------------- */
  /* route guard — keeps the three role pages honest                        */
  /* ---------------------------------------------------------------------- */
  function guardRole(requiredRole) {
    var user = D.getCurrentUser();
    var root = pathToRoot();
    if (!user) { window.location.href = root + "index.html"; return null; }
    if (user.status === "inactive") {
      // Deactivated after they'd already logged in — a valid session must not
      // outlive the account being turned off, so force it closed right here.
      D.logout();
      window.location.href = root + "index.html";
      return null;
    }
    if (user.role !== requiredRole) {
      var dest = user.role === "user" ? "userpage.html" : user.role === "admin" ? "adminpage.html" : "superadminpage.html";
      window.location.href = (document.body.dataset.depth === "1" ? "" : "pages/") + dest;
      return null;
    }
    return user;
  }

  function roleTabHTML(role) {
    var label = role === "superadmin" ? "Super Admin" : role === "admin" ? "Admin" : "User";
    return '<span class="role-tab ' + role + '">' + label + '</span>';
  }
  function statusChipHTML(status) {
    var label = status.charAt(0).toUpperCase() + status.slice(1);
    return '<span class="chip-status ' + status + '">' + label + '</span>';
  }

  /* ---------------------------------------------------------------------- */
  /* reusable form atoms                                                     */
  /* ---------------------------------------------------------------------- */
  function passwordFieldHTML(id, label, placeholder, value) {
    return (
      '<label class="field"><div class="field-label">' + esc(label) + '</div>' +
        '<div class="password-wrap">' +
          '<input class="input" type="password" id="' + id + '" placeholder="' + esc(placeholder || "") + '" value="' + esc(value || "") + '" maxlength="64" required>' +
          '<button type="button" class="pw-toggle" data-target="' + id + '" aria-label="Show password">' + I.eye(16) + '</button>' +
        '</div>' +
      '</label>'
    );
  }
  function wirePasswordToggles(root) {
    $all(".pw-toggle", root).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var input = document.getElementById(btn.dataset.target);
        var showing = input.type === "text";
        input.type = showing ? "password" : "text";
        btn.innerHTML = showing ? I.eye(16) : I.eyeOff(16);
      });
    });
  }
  function emailComposeFieldHTML(id, label, placeholder, value) {
    return (
      '<label class="field"><div class="field-label">' + esc(label) + '</div>' +
        '<div class="email-compose">' +
          '<input class="input" id="' + id + '" placeholder="' + esc(placeholder || "") + '" value="' + esc(value || "") + '" maxlength="30" autocapitalize="off" autocorrect="off" required>' +
          '<span class="email-domain">' + D.EMAIL_DOMAIN + '</span>' +
        '</div>' +
      '</label>'
    );
  }

  /* ---------------------------------------------------------------------- */
  /* privacy & cookie policy — the consent gate shown before sign-in         */
  /* ---------------------------------------------------------------------- */
  var POLICY_HTML =
    '<h4>Cookies (simulated)</h4>' +
    '<p>This prototype stores a small cookie in your browser named <code>' + D.CONSENT_COOKIE + '</code> ' +
    'purely to remember that you have reviewed this notice, so you are not asked again on your next visit.</p>' +
    '<h4>Your data</h4>' +
    '<p>Account details, requirement status, tags and uploaded file names are stored locally in your browser ' +
    '(localStorage) for demonstration purposes — no data leaves this device.</p>' +
    '<h4>Consent</h4>' +
    '<p>By checking the box you agree to this notice for the WB-T&amp;C Progress Monitoring System prototype.</p>';

  function consentBoxHTML(checked) {
    return (
      '<div class="consent-box">' +
        '<label class="consent-check">' +
          '<input type="checkbox" id="consentCheckbox"' + (checked ? " checked" : "") + '>' +
          '<span>' + I.cookie(13) + ' &nbsp;I have read and accept the ' +
            '<button type="button" class="link-btn" id="viewPolicyBtn">Privacy Policy &amp; Cookie Notice</button>' +
          '</span>' +
        '</label>' +
      '</div>'
    );
  }
  function policyModalHTML() {
    return (
      '<div class="modal-overlay" id="policyOverlay">' +
        '<div class="modal-card">' +
          '<div class="modal-head"><h3>' + I.cookie(17) + ' Privacy &amp; Cookie Notice</h3>' +
            '<button type="button" class="modal-close" id="policyCloseX">' + I.x(18) + '</button></div>' +
          '<div class="modal-body">' + POLICY_HTML + '</div>' +
          '<div class="modal-foot"><button type="button" class="btn btn-primary small" id="policyCloseBtn">Close</button></div>' +
        '</div>' +
      '</div>'
    );
  }

  /* ---------------------------------------------------------------------- */
  /* shared header + logout, rendered into every dashboard page              */
  /* ---------------------------------------------------------------------- */
  /* ---------------------------------------------------------------------- */
  /* shell — persistent sidebar + topbar, shared across all three dashboards */
  /* ---------------------------------------------------------------------- */
  function shellOpenHTML(user, subtitle, navItems, activeKey, contentClass) {
    var activeItem = navItems.filter(function (n) { return n.key === activeKey; })[0] || navItems[0];
    return (
      '<div class="app-shell">' +
        '<div class="sidebar">' +
          '<div class="sidebar-brand">' +
            '<div class="brand-id">' +
              '<div class="mark"><img src="' + assetPath("pup-logo.png") + '" alt="PUP seal" class="mark-img" /></div>' +
              '<div><div class="sidebar-title">WB-T&amp;C</div><div class="sidebar-subtitle">' + esc(subtitle) + '</div></div>' +
            '</div>' +
            '<button type="button" class="menu-toggle" id="menuToggle" aria-label="Toggle menu">' + I.menu(18) + '</button>' +
          '</div>' +
          '<div class="sidebar-nav">' +
            navItems.map(function (n) {
              return '<button class="side-link' + (n.key === activeKey ? ' active' : '') + '" data-tab="' + n.key + '">' +
                I[n.icon](16) + ' <span>' + esc(n.label) + '</span>' +
                (n.badge ? '<span class="badge-count">' + n.badge + '</span>' : '') +
              '</button>';
            }).join("") +
          '</div>' +
          '<div class="sidebar-foot">' +
            '<div class="sidebar-user">' + I.circleUser(24, "#D8D3CB") +
              '<div><div class="sidebar-user-name">' + esc(user.name) + '</div>' + roleTabHTML(user.role) + '</div>' +
            '</div>' +
            '<button class="btn btn-ghost small sidebar-logout" id="logoutBtn">' + I.logout(14) + ' Log out</button>' +
          '</div>' +
        '</div>' +
        '<div class="main-area">' +
          '<div class="topbar"><div class="topbar-title">' + esc(activeItem.label) + '</div></div>' +
          '<div class="content' + (contentClass ? " " + contentClass : "") + '">'
    );
  }
  function shellCloseHTML() { return "</div></div></div>"; }
  function wireHeader() {
    var btn = $("#logoutBtn");
    if (btn) btn.addEventListener("click", function () {
      D.logout();
      window.location.href = pathToRoot() + "index.html";
    });
    var toggle = $("#menuToggle");
    var sidebar = $(".sidebar");
    if (toggle && sidebar) {
      toggle.addEventListener("click", function () {
        sidebar.classList.toggle("menu-open");
      });
    }
  }

  function greetingHTML(title, subtitle) {
    return '<div class="greeting"><h2>' + esc(title) + '</h2><p>' + esc(subtitle) + '</p></div>';
  }
  function quickStatsHTML(items) {
    // items: [{icon, num, label, bg, fg}]
    return '<div class="quick-stats">' + items.map(function (it) {
      return (
        '<div class="quick-stat">' +
          '<div class="qs-icon" style="background:' + it.bg + '">' + I[it.icon](17, it.fg) + '</div>' +
          '<div><div class="qs-num">' + it.num + '</div><div class="qs-label">' + esc(it.label) + '</div></div>' +
        '</div>'
      );
    }).join("") + '</div>';
  }

  /* ---------------------------------------------------------------------- */
  /* panel-grid system — dense, edge-to-edge dashboard panels styled after   */
  /* a BI/reporting layout: icon-badge header bar, zebra tables, status      */
  /* pills. Every dashboard tab is assembled from these building blocks.     */
  /* ---------------------------------------------------------------------- */
  function panelHTML(opts) {
    // opts: { icon, iconAccent, title, extraHTML, bodyHTML, flush, scroll }
    var bodyClass = "panel-body" + (opts.flush ? " flush" : "") + (opts.scroll ? " scroll" : "");
    return (
      '<div class="panel">' +
        '<div class="panel-header">' +
          '<div class="panel-icon' + (opts.iconAccent ? " accent-" + opts.iconAccent : "") + '">' + I[opts.icon](14) + '</div>' +
          '<div class="panel-title">' + esc(opts.title) + '</div>' +
          (opts.extraHTML ? '<div class="panel-extra">' + opts.extraHTML + '</div>' : "") +
        '</div>' +
        '<div class="' + bodyClass + '">' + opts.bodyHTML + '</div>' +
      '</div>'
    );
  }
  function statPanelHTML(items) {
    // items: [{icon, num, label, bg, fg}] — a top strip of compact stat panels
    return '<div class="dash-grid top-strip">' + items.map(function (it) {
      return (
        '<div class="panel"><div class="stat-panel-body">' +
          '<div class="stat-panel-icon" style="background:' + it.bg + '">' + I[it.icon](17, it.fg) + '</div>' +
          '<div><div class="stat-panel-num">' + it.num + '</div><div class="stat-panel-label">' + esc(it.label) + '</div></div>' +
        '</div></div>'
      );
    }).join("") + '</div>';
  }
  function pillHTML(text, tone) {
    return '<span class="pill pill-' + (tone || "gray") + '">' + esc(text) + '</span>';
  }
  function statusPillHTML(status) {
    var tone = { approved: "green", active: "green", pending: "yellow", inactive: "red" }[status] || "gray";
    return pillHTML(status.charAt(0).toUpperCase() + status.slice(1), tone);
  }
  function zebraTableHTML(headers, rows, emptyIcon, emptyText) {
    if (rows.length === 0) {
      return '<div class="panel-empty">' + I[emptyIcon](26) + '<div>' + esc(emptyText) + '</div></div>';
    }
    return (
      '<table class="zebra-table"><thead><tr>' +
        headers.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") +
      '</tr></thead><tbody>' +
        rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>"; }).join("") +
      '</tbody></table>'
    );
  }

  function kindIcon(kind, size, color) {
    size = size || 14; color = color || "var(--sub)";
    return kind === "pptx" ? I.presentation(size, color) : kind === "xlsx" ? I.fileSpreadsheet(size, color) : I.fileText(size, color);
  }
  function fileListHTML(uploads) {
    return uploads.length === 0
      ? '<div style="font-size:11.5px;color:var(--sub);margin-top:6px;">No files submitted yet.</div>'
      : '<div class="stack-8" style="margin-top:8px;">' + uploads.map(function (u) {
          return '<div class="file-row">' + kindIcon(u.kind) +
            '<span class="name">' + esc(u.name) + '</span>' +
            '<span class="date">' + D.fmtDate(u.date) + '</span>' +
            '<button type="button" class="file-view-btn" data-view-file="' + esc(u.id || "") + '" title="View / download">' + I.download(13) + '</button>' +
          '</div>';
        }).join("") + '</div>';
  }
  function wireFileViewButtons(app) {
    $all("[data-view-file]", app).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var url = D.getFileDataUrl(btn.dataset.viewFile);
        if (url) { window.open(url, "_blank"); }
        else { alert("No file data stored for this entry — it may be a demo record from before file storage was added."); }
      });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* gallery — library view of every submitted Capstone/Thesis project,      */
  /* shared by the Admin and Super Admin consoles                            */
  /* ---------------------------------------------------------------------- */
  function collectGalleryEntries(db) {
    var entries = [];
    db.users.filter(function (u) { return u.role === "user"; }).forEach(function (u) {
      u.tasks.forEach(function (t) {
        t.uploads.forEach(function (up) {
          entries.push({
            fileId: up.id, name: up.name, kind: up.kind, date: up.date,
            student: u.name, program: u.program, taskTitle: t.title, taskId: t.id
          });
        });
      });
    });
    entries.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    return entries;
  }
  /** Same entry shape as collectGalleryEntries, scoped to one student's own
   *  tasks — used by the User dashboard's Gallery tab. */
  function collectUserGalleryEntries(user) {
    var entries = [];
    user.tasks.forEach(function (t) {
      t.uploads.forEach(function (up) {
        entries.push({
          fileId: up.id, name: up.name, kind: up.kind, date: up.date,
          student: user.name, program: user.program, taskTitle: t.title, taskId: t.id
        });
      });
    });
    entries.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    return entries;
  }
  function filterGalleryEntries(entries, state) {
    var q = (state.gallerySearch || "").trim().toLowerCase();
    return entries.filter(function (e) {
      if (state.galleryProgram && e.program !== state.galleryProgram) return false;
      if (state.galleryType && e.taskId !== state.galleryType) return false;
      if (q && e.student.toLowerCase().indexOf(q) === -1 && e.name.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function galleryFilterBarHTML(state, opts) {
    opts = opts || {};
    return (
      '<div class="gallery-filters">' +
        '<div class="search-box" style="max-width:260px;margin-bottom:0;">' + I.search(15) +
          '<input class="input" id="gallerySearch" placeholder="Search by ' + (opts.hideProgram ? "file name" : "student or file") + '…" value="' + esc(state.gallerySearch || "") + '"></div>' +
        (opts.hideProgram ? "" :
          '<select class="course-select" id="galleryProgramFilter">' +
            '<option value="">All Courses</option>' +
            D.PROGRAMS.map(function (p) { return '<option value="' + p + '"' + (state.galleryProgram === p ? " selected" : "") + '>' + p + '</option>'; }).join("") +
          '</select>') +
        '<select class="course-select" id="galleryTypeFilter">' +
          '<option value="">All Types</option>' +
          D.TASK_DEFS.map(function (t) { return '<option value="' + t.id + '"' + (state.galleryType === t.id ? " selected" : "") + '>' + t.title + '</option>'; }).join("") +
        '</select>' +
      '</div>'
    );
  }
  function galleryGridHTML(entries) {
    if (entries.length === 0) return emptyState("gallery", "No course projects match these filters.");
    return '<div class="gallery-grid">' + entries.map(function (e) {
      var isThesis = e.taskId === "thesis";
      var accent = isThesis ? "var(--yellow-dark)" : "var(--red)";
      return (
        '<div class="gallery-card ' + (isThesis ? "type-thesis" : "type-capstone") + '">' +
          '<div class="gallery-icon">' + kindIcon(e.kind, 20, accent) + '</div>' +
          '<div class="gallery-name" title="' + esc(e.name) + '">' + esc(e.name) + '</div>' +
          '<div class="gallery-meta">' + esc(e.student) + '</div>' +
          '<div class="gallery-tags">' +
            '<span class="tag-chip">' + esc(e.program) + '</span>' +
            '<span class="tag-chip">' + esc(e.taskTitle) + '</span>' +
          '</div>' +
          '<div class="gallery-foot">' +
            '<span class="gallery-date">' + D.fmtDate(e.date) + '</span>' +
            '<button type="button" class="file-view-btn" data-view-file="' + esc(e.fileId) + '" title="View / download">' + I.download(14) + '</button>' +
          '</div>' +
        '</div>'
      );
    }).join("") + '</div>';
  }
  function wireGalleryFilters(app, state, render) {
    var search = $("#gallerySearch", app);
    if (search) {
      search.addEventListener("input", function () { state.gallerySearch = search.value; render(); });
      var val = search.value;
      search.focus();
      search.value = val;
      search.setSelectionRange(val.length, val.length);
    }
    var programSel = $("#galleryProgramFilter", app);
    if (programSel) programSel.addEventListener("change", function () { state.galleryProgram = programSel.value; render(); });
    var typeSel = $("#galleryTypeFilter", app);
    if (typeSel) typeSel.addEventListener("change", function () { state.galleryType = typeSel.value; render(); });
  }
  function courseSelectHTML(userId, currentProgram) {
    return '<select class="course-select" data-program-select="' + userId + '">' +
      D.PROGRAMS.map(function (p) {
        return '<option value="' + p + '"' + (p === currentProgram ? " selected" : "") + '>' + p + '</option>';
      }).join("") +
    '</select>';
  }

  /* ---------------------------------------------------------------------- */
  /* skeleton — shown briefly the moment a dashboard page opens              */
  /* ---------------------------------------------------------------------- */
  function skeletonDashboardHTML() {
    return (
      '<div class="skel-shell">' +
        '<div class="skel-sidebar">' +
          '<div class="skel skel-line" style="width:60%;height:40px;margin:16px 16px 0;"></div>' +
        '</div>' +
        '<div class="skel-main">' +
          '<div class="skel skel-topbar"></div>' +
          '<div class="content">' +
            '<div class="skel skel-line" style="width:200px;height:19px;"></div>' +
            '<div class="skel skel-line" style="width:300px;margin-bottom:20px;"></div>' +
            '<div class="quick-stats">' + [1, 2, 3].map(function () { return '<div class="skel skel-stat"></div>'; }).join("") + '</div>' +
            '<div class="grid-auto" style="margin-top:16px;">' + [1, 2, 3].map(function () { return '<div class="skel skel-card"></div>'; }).join("") + '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  /* ============================================================================
     INDEX.HTML — login / register
     ============================================================================ */
  function initLoginPage() {
    var already = D.getCurrentUser();
    if (already) {
      var dest = already.role === "user" ? "pages/userpage.html" : already.role === "admin" ? "pages/adminpage.html" : "pages/superadminpage.html";
      window.location.href = dest;
      return;
    }

    var state = {
      mode: "signin",
      consent: getCookie(D.CONSENT_COOKIE) === "1",
      showPolicy: false,
      identifier: "", password: "",
      rName: "", rEmail: "", rProgram: D.PROGRAMS[0], rPassword: ""
    };
    var app = $("#app");

    function captureFormState() {
      var idEl = $("#fIdentifier"), pwEl = $("#fPassword");
      if (idEl) state.identifier = idEl.value;
      if (pwEl) state.password = pwEl.value;
      var rn = $("#rName"), re = $("#rEmail"), rp = $("#rProgram"), rpw = $("#rPassword");
      if (rn) state.rName = rn.value;
      if (re) state.rEmail = re.value;
      if (rp) state.rProgram = rp.value;
      if (rpw) state.rPassword = rpw.value;
    }

    var demoAccounts = [
      { role: "superadmin", name: "Dr. Elena Santos", identifier: "santos", password: "super123" },
      { role: "admin", name: "Prof. Miguel Reyes", identifier: "reyes", password: "admin123" },
      { role: "user", name: "Juan Dela Cruz", identifier: "juan", password: "user123" }
    ];

    function render(msg) {
      var signinActive = state.mode === "signin";
      app.innerHTML =
        '<div class="login-shell">' +
          '<div class="brand-panel">' +
            '<div>' +
              '<div class="brand-mark"><div class="mark"><img src="' + assetPath("pup-logo.png") + '" alt="PUP seal" class="mark-img" /></div>' +
                '<span class="brand-eyebrow">CAMPUS RECORDS</span></div>' +
              '<h1 class="brand-title">WB-T&amp;C</h1>' +
              '<p class="brand-sub">Progress Monitoring System</p>' +
              '<p class="brand-copy">One filing system for Capstone and Thesis requirements — across BSIT, DIT, BSIE and BSBA.</p>' +
            '</div>' +
            '<div class="demo-list">' +
              '<div class="demo-label">TRY A DEMO ACCOUNT</div>' +
              demoAccounts.map(function (d) {
                return '<button type="button" class="demo-chip" data-id="' + esc(d.identifier) + '" data-pw="' + esc(d.password) + '">' +
                  '<span class="who">' + I.circleUser(16) + esc(d.name) + '</span>' + roleTabHTML(d.role) + '</button>';
              }).join("") +
            '</div>' +
          '</div>' +
          '<div class="form-panel">' +
            '<div class="form-wrap">' +
              '<div class="mode-switch">' +
                '<button type="button" class="mode-btn' + (signinActive ? ' active' : '') + '" data-mode="signin">' + I.login(15) + ' Sign In</button>' +
                '<button type="button" class="mode-btn' + (!signinActive ? ' active' : '') + '" data-mode="register">' + I.userPlus(15) + ' Register</button>' +
              '</div>' +
              (msg ? '<div class="msg ' + msg.type + '">' + esc(msg.text) + '</div>' : '') +
              (signinActive ? signinFormHTML() : registerFormHTML()) +
              consentBoxHTML(state.consent) +
            '</div>' +
          '</div>' +
          (state.showPolicy ? policyModalHTML() : '') +
        '</div>';
      wire();
      wirePasswordToggles(app);
    }

    function signinFormHTML() {
      return (
        '<form id="signinForm">' +
          emailComposeFieldHTML("fIdentifier", "PUP Email", "yourname", state.identifier) +
          passwordFieldHTML("fPassword", "Password", "Enter your password", state.password) +
          '<button type="submit" class="btn btn-red" id="signinSubmit">' + I.login(15) + ' Sign In</button>' +
        '</form>'
      );
    }
    function registerFormHTML() {
      return (
        '<form id="registerForm">' +
          '<label class="field"><div class="field-label">Full Name</div>' +
            '<input class="input" id="rName" placeholder="Dela Cruz, Juan" value="' + esc(state.rName) + '" maxlength="60" required></label>' +
          emailComposeFieldHTML("rEmail", "PUP Email", "juandelacruz", state.rEmail) +
          '<label class="field"><div class="field-label">Program</div>' +
            '<select class="input" id="rProgram">' + D.PROGRAMS.map(function (p) {
              return '<option value="' + p + '"' + (p === state.rProgram ? " selected" : "") + '>' + p + '</option>';
            }).join("") + '</select></label>' +
          passwordFieldHTML("rPassword", "Password", "Create a password", state.rPassword) +
          '<div class="msg hint">New accounts start as <b style="color:var(--ink)">view-only</b>. An Admin unlocks your Capstone and Thesis uploads after review.</div>' +
          '<button type="submit" class="btn btn-red" id="registerSubmit">' + I.userPlus(15) + ' Create Account</button>' +
        '</form>'
      );
    }

    function wire() {
      $all(".mode-btn").forEach(function (b) {
        b.addEventListener("click", function () { captureFormState(); state.mode = b.dataset.mode; render(null); });
      });
      $all(".demo-chip").forEach(function (b) {
        b.addEventListener("click", function () {
          state.mode = "signin";
          state.identifier = b.dataset.id;
          state.password = b.dataset.pw;
          render(null);
        });
      });

      // consent checkbox — remembered via a simulated cookie
      var consentBox = $("#consentCheckbox");
      if (consentBox) consentBox.addEventListener("change", function () {
        state.consent = consentBox.checked;
        if (state.consent) setCookie(D.CONSENT_COOKIE, "1", 365); else deleteCookie(D.CONSENT_COOKIE);
        var s1 = $("#signinSubmit"), s2 = $("#registerSubmit");
        if (s1) s1.disabled = !state.consent;
        if (s2) s2.disabled = !state.consent;
      });
      var viewPolicyBtn = $("#viewPolicyBtn");
      if (viewPolicyBtn) viewPolicyBtn.addEventListener("click", function () { captureFormState(); state.showPolicy = true; render(null); });
      var closeX = $("#policyCloseX"), closeBtn = $("#policyCloseBtn"), overlay = $("#policyOverlay");
      [closeX, closeBtn].forEach(function (b) { if (b) b.addEventListener("click", function () { captureFormState(); state.showPolicy = false; render(null); }); });
      if (overlay) overlay.addEventListener("click", function (e) { if (e.target === overlay) { captureFormState(); state.showPolicy = false; render(null); } });

      // reflect current consent state on the submit buttons every render
      var s1 = $("#signinSubmit"), s2 = $("#registerSubmit");
      if (s1) s1.disabled = !state.consent;
      if (s2) s2.disabled = !state.consent;

      var signinForm = $("#signinForm");
      if (signinForm) signinForm.addEventListener("submit", function (e) {
        e.preventDefault();
        state.identifier = $("#fIdentifier").value;
        state.password = $("#fPassword").value;
        if (!state.consent) { render({ type: "error", text: "Please accept the Privacy Policy & Cookie Notice first." }); return; }
        var email = D.composeEmail(state.identifier);
        var res = D.login(email, state.password);
        if (!res.ok) { render({ type: "error", text: res.message }); return; }
        var dest = res.user.role === "user" ? "pages/userpage.html" : res.user.role === "admin" ? "pages/adminpage.html" : "pages/superadminpage.html";
        var btn = $("#signinSubmit");
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span> Signing in…'; }
        $all(".mode-btn, .demo-chip").forEach(function (b) { b.disabled = true; });
        setTimeout(function () { window.location.href = dest; }, 550);
      });
      var regForm = $("#registerForm");
      if (regForm) regForm.addEventListener("submit", function (e) {
        e.preventDefault();
        state.rName = $("#rName").value;
        state.rEmail = $("#rEmail").value;
        state.rProgram = $("#rProgram").value;
        state.rPassword = $("#rPassword").value;
        if (!state.consent) { render({ type: "error", text: "Please accept the Privacy Policy & Cookie Notice first." }); return; }
        var name = state.rName.trim(), email = D.composeEmail(state.rEmail),
            program = state.rProgram, password = state.rPassword;
        var res = D.register({ name: name, email: email, program: program, password: password });
        if (!res.ok) { render({ type: "error", text: res.message }); return; }
        state.mode = "signin";
        state.identifier = email.split("@")[0];
        state.password = "";
        state.rName = ""; state.rEmail = ""; state.rProgram = D.PROGRAMS[0]; state.rPassword = "";
        render({ type: "success", text: "Account filed as " + email + ". An Admin will review and unlock your requirements." });
      });
    }

    render(null);
  }

  /* ============================================================================
     USERPAGE.HTML
     ============================================================================ */
  function initUserPage() {
    var user = guardRole("user");
    if (!user) return;
    var app = $("#app");
    app.innerHTML = skeletonDashboardHTML();
    var state = { tab: "projects", uploadErrors: {}, uploadingTask: null, gallerySearch: "", galleryType: "" };

    function render() {
      user = D.getCurrentUser(); // re-read in case Admin changed something

      if (user.status === "pending") {
        var pendingNavItems = [{ key: "projects", label: "Course Projects", icon: "graduationCap" }];
        app.innerHTML =
          shellOpenHTML(user, "STUDENT RECORD", pendingNavItems, "projects", "narrow") +
          '<div class="fade-in">' +
            '<div class="card" style="text-align:center;padding:40px;border-top:4px solid var(--yellow);margin-top:8px;">' +
              I.clock(30, "var(--yellow-dark)") +
              '<h2 style="font-family:var(--font-display);font-size:20px;margin:14px 0 8px;">Awaiting Admin Approval</h2>' +
              '<p style="color:var(--sub);font-size:14px;line-height:1.6;margin:0 0 18px;">' +
                'Your account for <b style="color:var(--ink)">' + esc(user.program) + '</b> was filed on ' + D.fmtDate(user.createdAt) + '. ' +
                'Once approved, your Capstone and Thesis course projects will appear here, view-only, until an Admin unlocks uploads.' +
              '</p>' + statusChipHTML("pending") +
            '</div>' +
          '</div>' + shellCloseHTML();
        wireHeader();
        return;
      }

      var navItems = [
        { key: "projects", label: "Course Projects", icon: "graduationCap" },
        { key: "gallery", label: "Gallery", icon: "gallery" }
      ];

      var unlockedCount = user.tasks.filter(function (t) { return t.unlocked; }).length;
      var uploadCount = user.tasks.reduce(function (n, t) { return n + t.uploads.length; }, 0);
      var lockedCount = user.tasks.length - unlockedCount;
      var maxMB = D.MAX_FILE_BYTES / 1024 / 1024;

      var body;
      if (state.tab === "gallery") {
        var galleryEntries = filterGalleryEntries(collectUserGalleryEntries(user), state);
        body = panelHTML({
          icon: "gallery", iconAccent: "yellow", title: "My Course Project Gallery",
          bodyHTML: galleryFilterBarHTML(state, { hideProgram: true }) + galleryGridHTML(galleryEntries)
        });
      } else {
        var profileBody =
          '<div style="display:flex;align-items:center;gap:12px;">' +
            '<div style="width:38px;height:38px;border-radius:8px;background:var(--red-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0;">' + I.graduationCap(19, "var(--red)") + '</div>' +
            '<div><div style="font-weight:700;font-size:14px;">' + esc(user.program) + '</div>' +
            '<div style="font-size:11px;color:var(--sub);font-family:var(--font-mono);">Filed ' + D.fmtDate(user.createdAt) + '</div></div>' +
          '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px;">' +
            user.tags.map(function (t) { return '<span class="tag-chip">' + I.tag(10) + esc(t) + '</span>'; }).join("") +
            statusPillHTML(user.status) +
          '</div>';

        body =
          greetingHTML("Welcome back, " + firstName(user.name) + ".", "Here's where your Capstone and Thesis course projects stand.") +
          statPanelHTML([
            { icon: "unlock", num: unlockedCount, label: "UNLOCKED", bg: "var(--red-soft)", fg: "var(--red)" },
            { icon: "lock", num: lockedCount, label: "LOCKED", bg: "var(--paper-soft)", fg: "var(--sub)" },
            { icon: "upload", num: uploadCount, label: "FILES SUBMITTED", bg: "var(--yellow-soft)", fg: "var(--yellow-dark)" }
          ]) +
          '<div class="dash-grid cols-1-2" style="margin-bottom:0;">' +
            panelHTML({ icon: "graduationCap", iconAccent: "red", title: "Student Profile", bodyHTML: profileBody }) +
            '<div class="dash-grid cols-2" style="gap:12px;">' +
              user.tasks.map(function (task) {
                var uploading = state.uploadingTask === task.id;
                var err = state.uploadErrors[task.id];
                var taskBody =
                  '<div style="font-size:12px;color:var(--sub);margin-bottom:12px;">Course: <span style="font-family:var(--font-mono);">' + esc(task.tag) + '</span></div>' +
                  (task.unlocked ?
                    '<label class="btn btn-primary small" style="cursor:pointer;' + (uploading ? "opacity:.6;pointer-events:none;" : "") + '">' +
                      (uploading ? '<span class="btn-spinner"></span> Uploading…' : I.upload(13) + ' Upload File') +
                      '<input type="file" accept=".pdf,.ppt,.pptx,.xls,.xlsx" data-task="' + task.id + '" style="display:none" ' + (uploading ? "disabled" : "") + ' /></label>' +
                    '<div style="font-size:10.5px;color:var(--sub);margin-top:6px;">PDF, PPT/PPTX, XLS/XLSX — up to ' + maxMB + 'MB.</div>' +
                    (err ? '<div class="upload-error">' + I.alertTriangle(12) + ' ' + esc(err) + '</div>' : '')
                    : '<div style="font-size:12px;color:var(--sub);font-style:italic;">Locked by Admin — view only.</div>') +
                  '<div style="margin-top:12px;">' + fileListHTML(task.uploads) + '</div>';
                return panelHTML({
                  icon: task.unlocked ? "unlock" : "lock",
                  iconAccent: task.unlocked ? "red" : null,
                  title: task.title,
                  bodyHTML: taskBody
                });
              }).join("") +
            '</div>' +
          '</div>';
      }

      app.innerHTML =
        shellOpenHTML(user, "STUDENT RECORD", navItems, state.tab) +
        '<div class="tab-body fade-in">' + body + '</div>' +
        shellCloseHTML();

      wireHeader();
      wireFileViewButtons(app);
      wireGalleryFilters(app, state, render);
      $all(".side-link").forEach(function (b) { b.addEventListener("click", function () { state.tab = b.dataset.tab; render(); }); });
      $all('input[type="file"]').forEach(function (input) {
        input.addEventListener("change", function () {
          var f = input.files && input.files[0];
          var taskId = input.dataset.task;
          if (!f) return;

          var check = D.validateUploadFile(f);
          if (!check.ok) {
            state.uploadErrors[taskId] = check.message;
            render();
            return;
          }
          delete state.uploadErrors[taskId];
          state.uploadingTask = taskId;
          render();

          var reader = new FileReader();
          reader.onload = function () {
            var res = D.uploadFile(user.id, taskId, {
              id: D.uid("file"), name: f.name, kind: check.kind, size: f.size, dataUrl: reader.result
            });
            state.uploadingTask = null;
            if (!res.ok) state.uploadErrors[taskId] = res.message;
            render();
          };
          reader.onerror = function () {
            state.uploadingTask = null;
            state.uploadErrors[taskId] = "Couldn't read that file — please try again.";
            render();
          };
          reader.readAsDataURL(f);
        });
      });
    }

    setTimeout(render, 420);
  }

  /* ============================================================================
     ADMINPAGE.HTML
     ============================================================================ */
  function initAdminPage() {
    var user = guardRole("admin");
    if (!user) return;
    var app = $("#app");
    app.innerHTML = skeletonDashboardHTML();
    var state = { tab: "pending", tagDraft: {}, tagErrors: {}, search: "", gallerySearch: "", galleryProgram: "", galleryType: "" };

    function render() {
      var db = D.getDB();
      var students = db.users.filter(function (u) { return u.role === "user"; });
      var pending = students.filter(function (u) { return u.status === "pending"; });
      var approved = students.filter(function (u) { return u.status === "approved"; });
      var notifications = db.notifications.filter(function (n) { return n.forRoles.indexOf("admin") !== -1; });
      var totalUploads = students.reduce(function (n, s) { return n + s.tasks.reduce(function (m, t) { return m + t.uploads.length; }, 0); }, 0);

      var q = state.search.trim().toLowerCase();
      var approvedFiltered = !q ? approved : approved.filter(function (u) {
        return u.name.toLowerCase().indexOf(q) !== -1 || u.program.toLowerCase().indexOf(q) !== -1 || u.email.toLowerCase().indexOf(q) !== -1;
      });

      var navItems = [
        { key: "pending", label: "New Registrations", icon: "bell", badge: pending.length || null },
        { key: "manage", label: "Manage Students", icon: "users" },
        { key: "gallery", label: "Gallery", icon: "gallery" },
        { key: "notifications", label: "Notifications", icon: "clipboardList" }
      ];

      var body = "";
      if (state.tab === "pending") {
        var pendingRows = pending.map(function (u) {
          return [
            '<div style="font-weight:600;">' + esc(u.name) + '</div><div style="font-size:11px;color:var(--sub);">' + esc(u.email) + '</div>',
            courseSelectHTML(u.id, u.program),
            '<span style="font-family:var(--font-mono);font-size:11.5px;color:var(--sub);">' + D.fmtDate(u.createdAt) + '</span>',
            '<div style="display:flex;gap:6px;">' +
              '<button class="btn btn-ghost small" data-reject="' + u.id + '">' + I.x(13) + ' Reject</button>' +
              '<button class="btn btn-red small" data-approve="' + u.id + '">' + I.check(13) + ' Approve</button>' +
            '</div>'
          ];
        });
        body =
          greetingHTML("Welcome, " + firstName(user.name) + ".", "Here's what needs your attention today.") +
          statPanelHTML([
            { icon: "bell", num: pending.length, label: "AWAITING REVIEW", bg: "var(--yellow-soft)", fg: "var(--yellow-dark)" },
            { icon: "badgeCheck", num: approved.length, label: "APPROVED STUDENTS", bg: "var(--green-soft)", fg: "var(--green)" },
            { icon: "upload", num: totalUploads, label: "FILES ON RECORD", bg: "var(--red-soft)", fg: "var(--red)" }
          ]) +
          panelHTML({
            icon: "bell", iconAccent: "yellow", title: "New Registrations", flush: true,
            extraHTML: pending.length ? pillHTML(pending.length + " waiting", "yellow") : "",
            bodyHTML: zebraTableHTML(["Student", "Course", "Filed", "Actions"], pendingRows, "badgeCheck", "No pending registrations. All caught up.")
          });
      } else if (state.tab === "manage") {
        var studentPanels = approvedFiltered.map(function (u) {
          var taskRows = u.tasks.map(function (t) {
            return [
              '<b>' + esc(t.title) + '</b>',
              '<button class="btn small ' + (t.unlocked ? "btn-red" : "btn-ghost") + '" data-toggle-task="' + u.id + '|' + t.id + '">' +
                (t.unlocked ? I.unlock(12) + " Unlocked" : I.lock(12) + " Locked") + '</button>',
              fileListHTML(t.uploads)
            ];
          });
          var studentBody =
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px;flex-wrap:wrap;">' +
              '<div style="font-size:11.5px;color:var(--sub);">' + esc(u.email) + ' · Filed ' + D.fmtDate(u.createdAt) + '</div>' +
              courseSelectHTML(u.id, u.program) +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">' + u.tags.map(function (t) { return pillHTML(t, "gray"); }).join("") + '</div>' +
            '<div style="display:flex;gap:6px;margin-bottom:4px;">' +
              '<input class="input" style="width:100%;" placeholder="Add tag (e.g. Ready for Defense)" data-tag-input="' + u.id + '" value="' + esc(state.tagDraft[u.id] || "") + '" maxlength="40">' +
              '<button class="btn btn-ghost small" data-add-tag="' + u.id + '">' + I.plus(13) + '</button>' +
            '</div>' +
            (state.tagErrors[u.id] ? '<div class="upload-error" style="margin-bottom:8px;">' + I.alertTriangle(12) + ' ' + esc(state.tagErrors[u.id]) + '</div>' : '') +
            zebraTableHTML(["Project", "Access", "Files"], taskRows, "graduationCap", "No course projects.");
          return panelHTML({ icon: "circleUser", title: u.name, flush: false, bodyHTML: studentBody });
        });
        body =
          '<div class="search-box">' + I.search(15) + '<input class="input" id="studentSearch" placeholder="Search by name, program or email…" value="' + esc(state.search) + '"></div>' +
          (approved.length === 0
            ? emptyState("users", "No approved students yet.")
            : approvedFiltered.length === 0
              ? emptyState("search", "No students match your search.")
              : '<div class="dash-grid cols-2">' + studentPanels.join("") + '</div>');
      } else if (state.tab === "gallery") {
        var galleryEntries = filterGalleryEntries(collectGalleryEntries(db), state);
        body = panelHTML({
          icon: "gallery", iconAccent: "yellow", title: "Course Project Gallery",
          extraHTML: pillHTML(galleryEntries.length + " files", "gray"),
          bodyHTML: galleryFilterBarHTML(state) + galleryGridHTML(galleryEntries)
        });
      } else {
        var notifRows = notifications.map(function (n) {
          return ['<div style="display:flex;align-items:center;gap:8px;">' + I.bell(14, "var(--yellow-dark)") + '<span>' + esc(n.message) + '</span></div>',
            '<span style="font-family:var(--font-mono);font-size:11px;color:var(--sub);">' + D.fmtDateTime(n.date) + '</span>'];
        });
        body = panelHTML({
          icon: "clipboardList", title: "Notifications", flush: true,
          bodyHTML: zebraTableHTML(["Event", "When"], notifRows, "bell", "No notifications yet.")
        });
      }

      app.innerHTML =
        shellOpenHTML(user, "ADMIN CONSOLE", navItems, state.tab, "wide") +
        '<div class="tab-body fade-in">' + body + '</div>' +
        shellCloseHTML();

      wireHeader();
      wireFileViewButtons(app);
      wireGalleryFilters(app, state, render);
      $all(".side-link").forEach(function (b) { b.addEventListener("click", function () { state.tab = b.dataset.tab; render(); }); });
      $all("[data-approve]").forEach(function (b) { b.addEventListener("click", function () { D.approveUser(b.dataset.approve); render(); }); });
      $all("[data-reject]").forEach(function (b) { b.addEventListener("click", function () { D.rejectUser(b.dataset.reject); render(); }); });
      $all("[data-program-select]").forEach(function (sel) {
        sel.addEventListener("change", function () { D.setUserProgram(sel.dataset.programSelect, sel.value); render(); });
      });
      $all("[data-toggle-task]").forEach(function (b) {
        b.addEventListener("click", function () {
          var parts = b.dataset.toggleTask.split("|");
          var t = D.getDB().users.find(function (u) { return u.id === parts[0]; }).tasks.find(function (t) { return t.id === parts[1]; });
          D.setTaskUnlocked(parts[0], parts[1], !t.unlocked);
          render();
        });
      });
      $all("[data-tag-input]").forEach(function (inp) {
        inp.addEventListener("input", function () { state.tagDraft[inp.dataset.tagInput] = inp.value; });
      });
      $all("[data-add-tag]").forEach(function (b) {
        b.addEventListener("click", function () {
          var uid = b.dataset.addTag;
          var res = D.addTag(uid, state.tagDraft[uid] || "");
          if (!res.ok) { state.tagErrors[uid] = res.message; render(); return; }
          delete state.tagErrors[uid];
          state.tagDraft[uid] = "";
          render();
        });
      });
      var searchInput = $("#studentSearch");
      if (searchInput) {
        searchInput.addEventListener("input", function () { state.search = searchInput.value; render(); });
        // keep focus + caret position after re-render
        var val = searchInput.value;
        searchInput.focus();
        searchInput.value = val;
        searchInput.setSelectionRange(val.length, val.length);
      }
    }

    setTimeout(render, 420);
  }

  /* ============================================================================
     SUPERADMINPAGE.HTML
     ============================================================================ */
  function initSuperAdminPage() {
    var user = guardRole("superadmin");
    if (!user) return;
    var app = $("#app");
    app.innerHTML = skeletonDashboardHTML();
    var state = { tab: "admins", form: { name: "", email: "", password: "" }, msg: null, search: "", gallerySearch: "", galleryProgram: "", galleryType: "" };

    function render() {
      var db = D.getDB();
      var admins = db.users.filter(function (u) { return u.role === "admin"; });
      var activeAdmins = admins.filter(function (a) { return a.status === "active"; });
      var students = db.users.filter(function (u) { return u.role === "user"; });
      var pendingStudents = students.filter(function (s) { return s.status === "pending"; });
      var notifications = db.notifications.filter(function (n) { return n.forRoles.indexOf("superadmin") !== -1; });
      var byProgram = D.PROGRAMS.map(function (p) {
        return {
          program: p,
          count: students.filter(function (s) { return s.program === p; }).length,
          approved: students.filter(function (s) { return s.program === p && s.status === "approved"; }).length
        };
      });

      var q = state.search.trim().toLowerCase();
      var studentsFiltered = !q ? students : students.filter(function (s) {
        return s.name.toLowerCase().indexOf(q) !== -1 || s.program.toLowerCase().indexOf(q) !== -1;
      });

      var navItems = [
        { key: "admins", label: "Admin Accounts", icon: "shieldCheck" },
        { key: "progress", label: "Student Progress", icon: "graduationCap" },
        { key: "gallery", label: "Gallery", icon: "gallery" },
        { key: "notifications", label: "Notifications", icon: "bell", badge: pendingStudents.length || null }
      ];

      var greeting = greetingHTML("Welcome, " + firstName(user.name) + ".", "A system-wide view of admins and student progress.") +
        statPanelHTML([
          { icon: "shieldCheck", num: activeAdmins.length, label: "ACTIVE ADMINS", bg: "var(--red-soft)", fg: "var(--red)" },
          { icon: "graduationCap", num: students.length, label: "TOTAL STUDENTS", bg: "var(--yellow-soft)", fg: "var(--yellow-dark)" },
          { icon: "bell", num: pendingStudents.length, label: "PENDING REVIEW", bg: "var(--paper-soft)", fg: "var(--sub)" }
        ]);

      var body = "";
      if (state.tab === "admins") {
        var adminRows = admins.map(function (a) {
          return [
            '<div style="font-weight:600;">' + esc(a.name) + '</div><div style="font-size:11px;color:var(--sub);">' + esc(a.email) + '</div>',
            '<span style="font-family:var(--font-mono);font-size:11.5px;color:var(--sub);">' + D.fmtDate(a.createdAt) + '</span>',
            statusPillHTML(a.status),
            '<button class="btn small ' + (a.status === "active" ? "btn-danger" : "btn-ghost") + '" data-toggle-admin="' + a.id + '|' + (a.status === "active" ? "inactive" : "active") + '">' +
              (a.status === "active" ? I.shieldAlert(12) + " Deactivate" : I.shieldCheck(12) + " Reactivate") + '</button>'
          ];
        });
        var addAdminBody =
          (state.msg ? '<div class="msg ' + state.msg.type + '">' + esc(state.msg.text) + '</div>' : "") +
          '<form id="addAdminForm">' +
            '<label class="field"><div class="field-label">Full Name</div><input class="input" id="saName" value="' + esc(state.form.name) + '" maxlength="60"></label>' +
            emailComposeFieldHTML("saEmail", "PUP Email", "migreyes") +
            passwordFieldHTML("saPassword", "Temporary Password", "Create a password") +
            '<button type="submit" class="btn btn-red">' + I.plus(14) + ' Add Admin</button>' +
          '</form>';
        body = greeting +
          '<div class="dash-grid cols-2-1">' +
            panelHTML({
              icon: "shieldCheck", title: "Admin Accounts", flush: true,
              extraHTML: pillHTML(activeAdmins.length + " active", "green"),
              bodyHTML: zebraTableHTML(["Admin", "Filed", "Status", ""], adminRows, "shieldCheck", "No admin accounts yet.")
            }) +
            panelHTML({ icon: "plus", iconAccent: "red", title: "Add Admin Account", bodyHTML: addAdminBody }) +
          '</div>';
      } else if (state.tab === "progress") {
        var progressRows = studentsFiltered.map(function (s) {
          var uploadCount = s.tasks.reduce(function (n, t) { return n + t.uploads.length; }, 0);
          return [
            '<b>' + esc(s.name) + '</b>', esc(s.program), statusPillHTML(s.status),
            '<span style="font-family:var(--font-mono);font-size:11.5px;color:var(--sub);">' + D.fmtDate(s.createdAt) + '</span>',
            String(uploadCount)
          ];
        });
        body = greeting +
          '<div class="dash-grid cols-3" style="margin-bottom:12px;">' + byProgram.map(function (row) {
            return panelHTML({
              icon: "graduationCap", title: row.program,
              bodyHTML: '<div class="stat-panel-num" style="font-size:24px;">' + row.count + '</div><div class="stat-panel-label">' + row.approved + ' approved</div>'
            });
          }).join("") + '</div>' +
          panelHTML({
            icon: "search", title: "All Students (Read-only)", flush: true,
            extraHTML: '<input class="input" id="progressSearch" style="width:220px;" placeholder="Search by name or program…" value="' + esc(state.search) + '">',
            bodyHTML: zebraTableHTML(["Name", "Program", "Status", "Filed", "Uploads"], progressRows, "graduationCap", "No student accounts yet.")
          });
      } else if (state.tab === "gallery") {
        var galleryEntries = filterGalleryEntries(collectGalleryEntries(db), state);
        body = greeting + panelHTML({
          icon: "gallery", iconAccent: "yellow", title: "Course Project Gallery",
          extraHTML: pillHTML(galleryEntries.length + " files", "gray"),
          bodyHTML: galleryFilterBarHTML(state) + galleryGridHTML(galleryEntries)
        });
      } else {
        var saNotifRows = notifications.map(function (n) {
          return ['<div style="display:flex;align-items:center;gap:8px;">' + I.bell(14, "var(--red)") + '<span>' + esc(n.message) + '</span></div>',
            '<span style="font-family:var(--font-mono);font-size:11px;color:var(--sub);">' + D.fmtDateTime(n.date) + '</span>'];
        });
        body = greeting + panelHTML({
          icon: "bell", title: "Notifications", flush: true,
          bodyHTML: zebraTableHTML(["Event", "When"], saNotifRows, "bell", "No notifications yet.")
        });
      }

      app.innerHTML =
        shellOpenHTML(user, "SUPER ADMIN CONSOLE", navItems, state.tab, "wide") +
        '<div class="tab-body fade-in">' + body + '</div>' +
        shellCloseHTML();

      wireHeader();
      wirePasswordToggles(app);
      wireFileViewButtons(app);
      wireGalleryFilters(app, state, render);
      $all(".side-link").forEach(function (b) { b.addEventListener("click", function () { state.tab = b.dataset.tab; state.msg = null; render(); }); });
      $all("[data-toggle-admin]").forEach(function (b) {
        b.addEventListener("click", function () {
          var parts = b.dataset.toggleAdmin.split("|");
          D.setAdminStatus(parts[0], parts[1]);
          render();
        });
      });
      var form = $("#addAdminForm");
      if (form) form.addEventListener("submit", function (e) {
        e.preventDefault();
        var name = $("#saName").value.trim(), emailRaw = $("#saEmail").value.trim(), password = $("#saPassword").value;
        var email = D.composeEmail(emailRaw);
        var res = D.createAdmin({ name: name, email: email, password: password });
        if (!res.ok) { state.msg = { type: "error", text: res.message }; render(); return; }
        state.form = { name: "", email: "", password: "" };
        state.msg = { type: "success", text: name + " added as Admin (" + email + ")." };
        render();
      });
      var progressSearch = $("#progressSearch");
      if (progressSearch) {
        progressSearch.addEventListener("input", function () { state.search = progressSearch.value; render(); });
        var val = progressSearch.value;
        progressSearch.focus();
        progressSearch.value = val;
        progressSearch.setSelectionRange(val.length, val.length);
      }
    }

    setTimeout(render, 420);
  }

  /* ---------------------------------------------------------------------- */
  /* small shared render helpers                                             */
  /* ---------------------------------------------------------------------- */
  function emptyState(icon, text) {
    return '<div class="empty-state">' + I[icon](28) + '<div class="text">' + esc(text) + '</div></div>';
  }
  function notifRow(n, iconColor) {
    return '<div class="card notif-row">' + I.bell(16, iconColor) +
      '<div class="msg-text">' + esc(n.message) + '</div><div class="when">' + D.fmtDateTime(n.date) + '</div></div>';
  }

  /* ---------------------------------------------------------------------- */
  /* router                                                                    */
  /* ---------------------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", function () {
    var page = document.body.dataset.page;
    if (page === "login") initLoginPage();
    else if (page === "user") initUserPage();
    else if (page === "admin") initAdminPage();
    else if (page === "superadmin") initSuperAdminPage();
  });
})();
