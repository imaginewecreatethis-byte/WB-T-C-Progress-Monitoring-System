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
      D.logout().then(function () { window.location.href = root + "index.html"; });
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
    var label = D.roleLabel(role);
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
          '<input class="input" id="' + id + '" type="text" inputmode="email" placeholder="' + esc(placeholder || "") + '" value="' + esc(value || "") + '" maxlength="80" autocapitalize="off" autocorrect="off" spellcheck="false" required>' +
        '</div>' +
      '</label>'
    );
  }

  /* ---------------------------------------------------------------------- */
  /* privacy & cookie policy — the consent gate shown before sign-in         */
  /* ---------------------------------------------------------------------- */
  var POLICY_HTML =
    '<h4>Cookies and browser storage</h4>' +
    '<p>This site stores a small cookie named <code>' + D.CONSENT_COOKIE + '</code> ' +
    'to remember that you have reviewed this notice, plus browser storage that keeps you signed in and ' +
    'remembers that an account was created on this device.</p>' +
    '<h4>Your data</h4>' +
    '<p>Your name, PUP username, program, requirement status and the Capstone/Thesis files you upload are ' +
    'stored on the system\'s online database and file storage (Supabase). Admins and Teachers can see everything you submit. ' +
    'Approved students in your program can see and open the files submitted under your program.</p>' +
    '<h4>Automatic document check</h4>' +
    '<p>When you upload a PDF, Word or PowerPoint file, your browser reads it to estimate progress and look for layout and grammar problems. ' +
    'The file is not sent to any outside checking service. The progress percentage and the list of problems are saved with your file ' +
    'so your Teacher and Admin can see them. Notices and revision notes sent to you or about you are stored in the system as well.</p>' +
    '<h4>Consent</h4>' +
    '<p>By checking the box you agree to this notice for the WB-T&amp;C Progress Monitoring System.</p>';

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
      btn.disabled = true;
      D.logout().then(function () { window.location.href = pathToRoot() + "index.html"; });
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
    return kind === "pptx" ? I.presentation(size, color) : kind === "image" ? I.gallery(size, color) : I.fileText(size, color);
  }
  function usernameOf(u) { return ((u && u.email) || "").split("@")[0]; }

  /* ---- progress bar + "completed" tag ---- */
  function progressHTML(progress) {
    if (progress === null || progress === undefined) return '<div class="progress-na">Progress not scored</div>';
    var done = progress >= 100;
    return '<div class="progress-wrap">' +
      '<div class="progress-bar' + (done ? " done" : "") + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + progress + '"><span style="width:' + progress + '%"></span></div>' +
      '<span class="progress-num">' + progress + '%</span>' +
      (done ? '<span class="chip-completed">' + I.check(10) + ' completed</span>' : '') +
    '</div>';
  }

  /** The little icon buttons next to a file.
   *  perms: { staff, own, student } — student = a classmate's file in the Gallery (view / progress / download only) */
  function fileActionsHTML(up, perms) {
    perms = perms || {};
    var id = esc(up.id || "");
    var isImage = up.kind === "image";
    return '<div class="file-actions">' +
      '<button type="button" class="file-view-btn" data-open-file="' + id + '" title="View file">' + I.eye(13) + '</button>' +
      '<button type="button" class="file-view-btn" data-download-file="' + id + '" title="Download">' + I.download(13) + '</button>' +
      (!isImage && (perms.staff || perms.own) ? '<button type="button" class="file-view-btn" data-review-file="' + id + '" title="Document review (progress, layout, grammar)">' + I.search(13) + '</button>' : '') +
      (!isImage && perms.student ? '<button type="button" class="file-view-btn" data-progress-file="' + id + '" title="View progress">' + I.search(13) + '</button>' : '') +
      (perms.staff ? '<button type="button" class="file-view-btn" data-revise-file="' + id + '" title="Send revision notice">' + I.send(13) + '</button>' : '') +
      (perms.staff ? '<button type="button" class="file-view-btn danger" data-delete-file="' + id + '" title="Delete file">' + I.trash(13) + '</button>' : '') +
      (perms.own ? '<button type="button" class="file-view-btn danger" data-remove-own="' + id + '" title="Remove file">' + I.trash(13) + '</button>' : '') +
    '</div>';
  }
  function fileListHTML(uploads, perms) {
    return uploads.length === 0
      ? '<div style="font-size:11.5px;color:var(--sub);margin-top:6px;">No files submitted yet.</div>'
      : '<div style="margin-top:8px;">' + uploads.map(function (u) {
          return '<div class="file-item"><div class="file-row">' + kindIcon(u.kind) +
            '<span class="name" title="' + esc(u.name) + '">' + esc(u.name) + '</span>' +
            '<span class="date">' + D.fmtDate(u.date) + '</span>' +
            fileActionsHTML(u, perms) +
          '</div>' + (u.kind === "image" ? "" : progressHTML(u.progress)) + '</div>';
        }).join("") + '</div>';
  }
  function findFile(fileId) {
    var hit = null;
    D.getDB().users.forEach(function (u) {
      (u.tasks || []).forEach(function (t) {
        t.uploads.forEach(function (up) { if (up.id === fileId) hit = { upload: up, owner: u, task: t }; });
      });
    });
    return hit;
  }

  /* ---- modal plumbing: dialogs live on <body>, so a page refresh never closes them ---- */
  function openModal(html) {
    var wrap = document.createElement("div");
    wrap.innerHTML = html;
    var overlay = wrap.firstChild;
    document.body.appendChild(overlay);
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    return { el: overlay, close: close, $: function (sel) { return overlay.querySelector(sel); } };
  }

  /* ---- review dialog: progress %, layout, grammar ---- */
  var GRAMMAR_NOTE = "This is an automatic check. It catches common problems but it can miss things or flag correct writing, so use it as a guide, not a grade.";
  function openReviewModal(hit, opts) {
    opts = opts || {};
    var up = hit.upload, a = up.analysis, body = "";
    body += '<div style="font-weight:700;color:var(--ink);word-break:break-word;">' + esc(up.name) + '</div>' +
            '<div style="font-size:11.5px;color:var(--sub);margin-bottom:4px;">' + esc(hit.owner.name) + ' · ' + esc(hit.task.title) + '</div>' +
            progressHTML(up.progress);
    if (!a) {
      body += '<p style="margin-top:14px;">No automatic review was saved for this file.</p>';
    } else if (a.supported === false) {
      body += '<p style="margin-top:14px;">' + esc(a.note || "This file couldn't be checked automatically.") + '</p>';
    } else {
      var icon = { found: I.circleCheck(14, "#1E7C34"), thin: I.alertTriangle(14, "var(--yellow-dark)"), missing: I.x(14, "var(--red)") };
      var word = { found: "found", thin: "found, but very short", missing: "not found" };
      body += '<div class="review-sec"><h4>Progress — sections found</h4><ul class="review-list">' +
        (a.sections || []).map(function (sec) { return '<li>' + icon[sec.state] + '<span>' + esc(sec.label) + ' — ' + word[sec.state] + '</span></li>'; }).join("") +
        '</ul></div>';
      if (!opts.progressOnly) {
      var lIcon = { pass: I.circleCheck(14, "#1E7C34"), warn: I.alertTriangle(14, "var(--yellow-dark)"), info: I.info(14, "var(--sub)") };
      body += '<div class="review-sec"><h4>Layout</h4><ul class="review-list">' +
        (a.layout || []).map(function (l) { return '<li>' + (lIcon[l.status] || lIcon.info) + '<span>' + esc(l.text) + '</span></li>'; }).join("") +
        '</ul></div>';
      var g = a.grammar || { total: 0, issues: [] };
      body += '<div class="review-sec"><h4>Grammar and writing — ' + (g.total ? g.total + " thing" + (g.total === 1 ? "" : "s") + " to check" : "nothing found") + '</h4>' +
        (g.issues && g.issues.length ? '<ul class="review-list">' + g.issues.map(function (x) {
          return '<li>' + I.alertTriangle(14, "var(--yellow-dark)") + '<span>' + esc(x.msg) + ' <span style="color:var(--sub);">(' + esc(x.at) + ')</span><span class="ctx">' + esc(x.ctx) + '</span></span></li>';
        }).join("") + '</ul>' + (g.total > g.issues.length ? '<div class="hint-small">Showing the first ' + g.issues.length + ' of ' + g.total + '.</div>' : "") : "") +
        '</div>';
      }
    }
    body += opts.progressOnly ? '' : '<div class="review-note">' + esc(GRAMMAR_NOTE) + '</div>';
    var m = openModal(
      '<div class="modal-overlay"><div class="modal-card wide" role="dialog" aria-modal="true">' +
        '<div class="modal-head"><h3>' + I.search(17) + ' Document review</h3><button type="button" class="modal-close" data-close aria-label="Close">' + I.x(18) + '</button></div>' +
        '<div class="modal-body form-body">' + body + '</div>' +
        '<div class="modal-foot"><button type="button" class="btn btn-primary small" data-close>Close</button></div>' +
      '</div></div>');
    $all("[data-close]", m.el).forEach(function (b) { b.addEventListener("click", m.close); });
  }

  /* ---- compose dialog: revision notice (Admin / Teacher) or delete-with-note ---- */
  function openComposeModal(opts, done) {
    var me = opts.me, db = D.getDB();
    var students = db.users.filter(function (u) { return u.role === "user" && u.status === "approved"; });
    var del = opts.mode === "delete";
    var fixed = !!opts.studentId;
    var today = D.fmtDate(D.todayISO());
    var m = openModal(
      '<div class="modal-overlay"><div class="modal-card wide" role="dialog" aria-modal="true">' +
        '<div class="modal-head"><h3>' + I.send(17) + (del ? ' Delete file' : ' Revision notice') + '</h3><button type="button" class="modal-close" data-close aria-label="Close">' + I.x(18) + '</button></div>' +
        '<div class="modal-body form-body">' +
          '<label class="field"><div class="field-label">Select Student Name:</div>' +
            '<select class="input" id="cmStudent"' + (fixed ? " disabled" : "") + '>' +
              (fixed ? "" : '<option value="">— choose a student —</option>') +
              students.map(function (u) { return '<option value="' + esc(u.id) + '"' + (u.id === opts.studentId ? " selected" : "") + '>' + esc(u.name) + ' (' + esc(u.program) + ')</option>'; }).join("") +
            '</select></label>' +
          (opts.fileName ? '<div class="rev-line">' + (del ? "File name deletion: " : "About file: ") + '<b>' + esc(opts.fileName) + '</b></div>' : "") +
          '<label class="field"><div class="field-label">' + (del ? "Why is this file being deleted? (the student will read this)" : "Comment") + '</div>' +
            '<textarea class="input" id="cmBody" maxlength="1000" placeholder="Write your note…"></textarea></label>' +
          '<div class="hint-small" id="cmHint" style="margin:-6px 0 6px;">These characters aren\'t allowed: ' + esc(D.BLOCKED_CHARS_TEXT) + '</div>' +
          '<div class="rev-auto">Thank you “<b>' + esc(usernameOf(me)) + '</b>” <span class="auto">(Automatic)</span></div>' +
          '<div class="rev-auto">Date: <b>' + esc(today) + '</b> <span class="auto">(Automatic)</span></div>' +
          '<div class="upload-error" id="cmError" style="display:none;"></div>' +
        '</div>' +
        '<div class="modal-foot split"><button type="button" class="btn btn-ghost small" data-close>Close</button>' +
          '<button type="button" class="btn ' + (del ? "btn-danger" : "btn-red") + ' small" id="cmSend">' + (del ? I.trash(13) + " Delete &amp; send" : I.send(13) + " Send") + '</button></div>' +
      '</div></div>');
    $all("[data-close]", m.el).forEach(function (b) { b.addEventListener("click", m.close); });
    var cmBody = m.$("#cmBody"), cmHint = m.$("#cmHint");
    cmBody.addEventListener("input", function () {
      var clean = D.stripBlocked(cmBody.value);
      if (clean !== cmBody.value) { cmBody.value = clean; cmHint.style.color = "var(--red)"; }
    });
    var err = m.$("#cmError");
    function showErr(t) { err.style.display = "block"; err.textContent = t; }
    m.$("#cmSend").addEventListener("click", function () {
      var sid = m.$("#cmStudent").value, text = m.$("#cmBody").value.trim();
      if (!sid) return showErr("Choose a student first.");
      if (text.length < 3) return showErr(del ? "Write why the file is being deleted." : "Write your comment first.");
      var btn = m.$("#cmSend"); btn.disabled = true;
      var job = del ? D.removeSubmission(opts.fileId, text) : D.sendRevision(sid, text, opts.fileId || null);
      job.then(function (res) {
        if (!res.ok) { btn.disabled = false; return showErr(res.message); }
        m.close();
        if (done) done();
      });
    });
    setTimeout(function () { var t = m.$("#cmBody"); if (t) t.focus(); }, 30);
  }

  /* ---- read-only dialog for a notice (what a student sees as a pop-up) ---- */
  function openNoticeModal(n, me, done) {
    var from = n.actorUsername ? D.roleLabel(n.actorRole) + " " + n.actorUsername : "Admin";
    var isStaff = me.role !== "user";
    var isClr = n.kind === "clearance";
    var head = isClr ? "Clearance accepted" : isStaff
      ? (n.kind === "deleted" ? "File deleted" : "Revision notice sent") + (n.studentName ? ' — ' + n.studentName : "")
      : from;
    var m = openModal(
      '<div class="modal-overlay"><div class="modal-card wide" role="dialog" aria-modal="true">' +
        '<div class="modal-head"><h3>' + I.messageSquare(17) + ' ' + (isClr ? "Clearance" : n.kind === "deleted" ? "File deleted" : "Revision notice") + '</h3><button type="button" class="modal-close" data-close aria-label="Close">' + I.x(18) + '</button></div>' +
        '<div class="modal-body form-body">' +
          '<div class="rev-from">' + esc(head) + '</div>' +
          (n.fileName ? '<div class="rev-line">' + (n.kind === "deleted" ? "File name deletion: " : "About file: ") + '<b>' + esc(n.fileName) + '</b></div>' : "") +
          '<div class="rev-note">' + esc(n.body || n.message) + '</div>' +
          (isStaff || isClr ? "" : '<div class="rev-auto">Thank you “<b>' + esc(usernameOf(me)) + '</b>” <span class="auto">(Automatic)</span></div>') +
          '<div class="rev-auto">Date: <b>' + esc(D.fmtDateTime(n.date)) + '</b></div>' +
        '</div>' +
        '<div class="modal-foot"><button type="button" class="btn btn-primary small" data-close>Close</button></div>' +
      '</div></div>');
    $all("[data-close]", m.el).forEach(function (b) { b.addEventListener("click", function () { m.close(); if (done) done(); }); });
  }

  /* ---- Notifications tab: "Notification" and "Revision Notice", side by side ---- */
  function noticeRowsHTML(list) {
    return list.map(function (n) {
      var readable = n.body || n.kind === "revision" || n.kind === "deleted";
      return [
        '<div class="notif-event' + (n.seen ? "" : " unseen") + '">' + (n.panel === "revision" ? I.messageSquare(14, "var(--red)") : I.bell(14, "var(--yellow-dark)")) + '<span>' + esc(n.message) + '</span></div>',
        '<span style="font-family:var(--font-mono);font-size:11px;color:var(--sub);">' + D.fmtDateTime(n.date) + '</span>',
        '<div class="notif-actions">' +
          (readable ? '<button type="button" class="file-view-btn" data-read-note="' + esc(n.id) + '" title="Read">' + I.messageSquare(13) + '</button>' : "") +
          '<button type="button" class="file-view-btn danger" data-remove-note="' + esc(n.id) + '" title="Remove from my list">' + I.trash(13) + '</button>' +
        '</div>'
      ];
    });
  }
  function notificationsTabHTML(notes) {
    var left = notes.filter(function (n) { return n.panel === "notification"; });
    var right = notes.filter(function (n) { return n.panel === "revision"; });
    return '<div class="notif-split">' +
      panelHTML({ icon: "bell", iconAccent: "yellow", title: "Notification", flush: true,
        extraHTML: left.length ? pillHTML(left.length, "gray") : "",
        bodyHTML: zebraTableHTML(["Event", "When", ""], noticeRowsHTML(left), "bell", "No notifications yet.") }) +
      panelHTML({ icon: "messageSquare", iconAccent: "red", title: "Revision Notice", flush: true,
        extraHTML: right.length ? pillHTML(right.length, "gray") : "",
        bodyHTML: zebraTableHTML(["Event", "When", ""], noticeRowsHTML(right), "messageSquare", "No revision notices yet.") }) +
    '</div>';
  }

  function extOfName(name) { return (String(name || "").split(".").pop() || "").toLowerCase(); }
  function downloadFile(fileId, name) {
    D.getFileUrl(fileId, name || "file").then(function (url) {
      if (url) window.location.href = url;
      else window.alert("Couldn't download that file. It may have been removed, or you may not have access to it.");
    });
  }
  /** Shows the real file inside the page. */
  function openViewer(hit) {
    if (!window.Viewer) { downloadFile(hit.upload.id, hit.upload.name); return; }
    window.Viewer.open({
      title: hit.upload.name, ext: extOfName(hit.upload.name),
      getUrl: function () { return D.getFileUrl(hit.upload.id); },
      onDownload: function () { downloadFile(hit.upload.id, hit.upload.name); }
    });
  }

  /** Teacher / Admin: tap a Gallery card to get everything about the file in one pop-out. */
  function openFilePopup(hit, me, render) {
    var up = hit.upload, isImage = up.kind === "image";
    var m = openModal(
      '<div class="modal-overlay"><div class="modal-card" role="dialog" aria-modal="true">' +
        '<div class="modal-head"><h3>' + kindIcon(up.kind, 17) + ' File</h3><button type="button" class="modal-close" data-close aria-label="Close">' + I.x(18) + '</button></div>' +
        '<div class="modal-body form-body">' +
          '<div class="pop-line"><span class="pop-key">File name:</span> <b class="pop-val">' + esc(up.name) + '</b></div>' +
          '<div class="pop-line"><span class="pop-key">Username:</span> <b class="pop-val">' + esc(usernameOf(hit.owner)) + '</b> <span class="auto-note">' + esc(hit.owner.name) + ' · ' + esc(hit.task.title) + '</span></div>' +
          '<div class="pop-grid">' +
            '<button type="button" class="btn btn-red small pop-wide" data-pop="view">' + I.eye(13) + ' View file</button>' +
            '<button type="button" class="btn btn-ghost small" data-pop="download">' + I.download(13) + ' Download</button>' +
            (isImage ? '<button type="button" class="btn btn-ghost small" disabled title="Images have no document review">' + I.search(13) + ' Documented Review</button>'
                     : '<button type="button" class="btn btn-ghost small" data-pop="review">' + I.search(13) + ' Documented Review</button>') +
            '<button type="button" class="btn btn-ghost small" data-pop="revise">' + I.send(13) + ' Revision notice</button>' +
            '<button type="button" class="btn btn-danger small" data-pop="delete">' + I.trash(13) + ' Delete</button>' +
          '</div>' +
          (isImage ? '' : '<div class="pop-progress">' + progressHTML(up.progress) + '</div>') +
          '<div class="pop-line" style="margin-top:12px;"><span class="pop-key">Date:</span> <b class="pop-val">' + esc(D.fmtDateTime(up.date)) + '</b></div>' +
        '</div>' +
        '<div class="modal-foot"><button type="button" class="btn btn-primary small" data-close>Close</button></div>' +
      '</div></div>');
    $all("[data-close]", m.el).forEach(function (b) { b.addEventListener("click", m.close); });
    m.el.addEventListener("click", function (e) { if (e.target === m.el) m.close(); });
    $all("[data-pop]", m.el).forEach(function (b) {
      b.addEventListener("click", function () {
        var what = b.dataset.pop;
        if (what === "view") openViewer(hit);
        else if (what === "download") downloadFile(up.id, up.name);
        else if (what === "review") openReviewModal(hit);
        else if (what === "revise") { m.close(); openComposeModal({ me: me, mode: "revision", studentId: hit.owner.id, fileId: up.id, fileName: up.name }, render); }
        else if (what === "delete") { m.close(); openComposeModal({ me: me, mode: "delete", studentId: hit.owner.id, fileId: up.id, fileName: up.name }, render); }
      });
    });
  }

  /* ---- Release Clearance (Admin only) ---- */
  /** A tiny PDF writer (text only, Helvetica) so the clearance letter downloads without any outside library. */
  function buildPdf(blocks) {
    var pages = [[]], y = 730, WIDTH = 468;
    function latin(t) { return String(t).replace(/[^ -ÿ]/g, "?"); }
    function esc2(t) { return latin(t).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"); }
    blocks.forEach(function (b) {
      var size = b.size || 12, maxChars = Math.max(10, Math.floor(WIDTH / (size * (b.bold ? 0.56 : 0.52))));
      var words = latin(b.text).split(" "), line = "", lines = [];
      words.forEach(function (w) {
        if ((line + " " + w).trim().length > maxChars) { lines.push(line); line = w; } else line = (line + " " + w).trim();
      });
      lines.push(line);
      lines.forEach(function (ln) {
        if (y - size < 72) { pages.push([]); y = 730; }
        var x = 72;
        if (b.center) x = Math.max(72, 306 - ln.length * size * (b.bold ? 0.56 : 0.52) / 2);
        pages[pages.length - 1].push("BT /" + (b.bold ? "F2" : "F1") + " " + size + " Tf " + Math.round(x) + " " + Math.round(y) + " Td (" + esc2(ln) + ") Tj ET");
        y -= size * 1.55;
      });
      y -= b.after || 0;
    });
    var objs = [];
    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    var kids = [];
    pages.forEach(function (_, i) { kids.push((5 + i * 2) + " 0 R"); });
    objs[2] = "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + pages.length + " >>";
    objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    pages.forEach(function (cmds, i) {
      var stream = cmds.join("\n");
      objs[5 + i * 2] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents " + (6 + i * 2) + " 0 R >>";
      objs[6 + i * 2] = "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream";
    });
    var out = "%PDF-1.4\n", offsets = [];
    for (var n = 1; n < objs.length; n++) { offsets[n] = out.length; out += n + " 0 obj\n" + objs[n] + "\nendobj\n"; }
    var xref = out.length;
    out += "xref\n0 " + objs.length + "\n0000000000 65535 f \n";
    for (var k = 1; k < objs.length; k++) out += ("0000000000" + offsets[k]).slice(-10) + " 00000 n \n";
    out += "trailer\n<< /Size " + objs.length + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF";
    var bytes = new Uint8Array(out.length);
    for (var c = 0; c < out.length; c++) bytes[c] = out.charCodeAt(c) & 255;
    return new Blob([bytes], { type: "application/pdf" });
  }

  function clearanceBlocks(names) {
    var blocks = [
      { text: "RELEASE CLEARANCE", size: 16, bold: true, center: true, after: 14 },
      { text: "The following " + names.length + " student" + (names.length === 1 ? "" : "s") + " have been cleared for their Capstone / Research Hardbound", size: 12, after: 10 }
    ];
    names.forEach(function (n, i) { blocks.push({ text: (i + 1) + ". " + n, size: 12 }); });
    blocks.push({ text: "", size: 12, after: 24 });
    blocks.push({ text: "Cecilia Q. Nacpil", size: 12, bold: true });
    blocks.push({ text: "Head, Library Services", size: 12 });
    return blocks;
  }

  /* ---- delete a student / teacher (5-second wait before Yes) ---- */
  function openDeleteConfirm(opts) {
    var secs = 5, timer = null;
    var m = openModal(
      '<div class="modal-overlay"><div class="modal-card" role="dialog" aria-modal="true">' +
        '<div class="modal-head"><h3>' + I.alertTriangle(17) + ' Delete ' + esc(opts.kind) + '</h3></div>' +
        '<div class="modal-body form-body">' +
          '<p style="margin:0 0 10px;font-weight:600;color:var(--ink);">Are you sure this ' + esc(opts.kind) + ' will be permanently deleted on this program' + (opts.kind === "Student" ? " and works" : "") + '?</p>' +
          '<div class="del-name">' + esc(opts.name) + '</div>' +
          '<div class="auto-note" id="delWait">You can click Yes in 5 seconds.</div>' +
          '<div class="upload-error" id="delError" style="display:none;margin-top:8px;"></div>' +
        '</div>' +
        '<div class="modal-foot split"><button type="button" class="btn btn-ghost small" id="delNo">Cancel</button>' +
          '<button type="button" class="btn btn-danger small" id="delYes" disabled>' + I.trash(13) + ' Yes (5)</button></div>' +
      '</div></div>');
    function closeAll() { if (timer) clearInterval(timer); m.close(); }
    var yes = m.$("#delYes");
    m.$("#delNo").addEventListener("click", closeAll);
    timer = setInterval(function () {
      secs--;
      if (secs > 0) { yes.innerHTML = I.trash(13) + " Yes (" + secs + ")"; return; }
      clearInterval(timer); timer = null;
      yes.disabled = false; yes.innerHTML = I.trash(13) + " Yes, delete";
      m.$("#delWait").textContent = "This cannot be undone.";
    }, 1000);
    yes.addEventListener("click", function () {
      yes.disabled = true; yes.innerHTML = '<span class="btn-spinner"></span> Deleting…';
      opts.onYes().then(function (res) {
        if (!res.ok) { yes.disabled = false; yes.innerHTML = I.trash(13) + " Yes, delete"; var e = m.$("#delError"); e.style.display = "block"; e.textContent = res.message; return; }
        closeAll();
        if (opts.after) opts.after();
      });
    });
  }
  function openDeletedModal() {
    var list = D.getDeleted();
    var m = openModal(
      '<div class="modal-overlay"><div class="modal-card wide" role="dialog" aria-modal="true">' +
        '<div class="modal-head"><h3>' + I.trash(17) + ' Recently Deleted</h3><button type="button" class="modal-close" data-close aria-label="Close">' + I.x(18) + '</button></div>' +
        '<div class="modal-body">' + (list.length
          ? '<div class="del-list">' + list.map(function (r) {
              return '<div class="del-item"><div><b>' + esc(r.person_name) + '</b> ' + pillHTML(r.kind === "teacher" ? "Teacher" : "Student", "gray") +
                (r.program ? ' <span class="auto-note">(' + esc(r.program) + ')</span>' : "") +
                '<div class="auto-note">' + esc(r.username || "") + (r.kind === "student" ? " · " + r.files_removed + " file" + (r.files_removed === 1 ? "" : "s") + " removed" : "") + '</div></div>' +
                '<div class="auto-note" style="text-align:right;">Deleted by ' + esc(r.deleted_by_name || "—") + '<br>' + D.fmtDateTime(r.deleted_at) + '</div></div>';
            }).join("") + '</div>'
          : '<div class="auto-note" style="padding:8px 0;">Nothing has been deleted yet.</div>') + '</div>' +
        '<div class="modal-foot"><button type="button" class="btn btn-ghost small" data-close>Close</button></div>' +
      '</div></div>');
    $all("[data-close]", m.el).forEach(function (b) { b.addEventListener("click", m.close); });
  }

  function openClearanceModal(me, render) {
    var students = D.getDB().users.filter(function (u) { return u.role === "user" && u.status === "approved"; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    var manual = [];   // names typed by hand (these people may not have an account)
    var m = openModal(
      '<div class="modal-overlay"><div class="modal-card wide" role="dialog" aria-modal="true">' +
        '<div class="modal-head"><h3>' + I.circleCheck(17) + ' Release Clearance</h3><button type="button" class="modal-close" data-close aria-label="Close">' + I.x(18) + '</button></div>' +
        '<div class="modal-body form-body clr-body">' +
          '<div class="field-label" style="margin-bottom:6px;">Select the students to clear:</div>' +
          '<div class="clr-list">' + (students.length ? students.map(function (u) {
            return '<label><input type="checkbox" class="clr-pick" value="' + esc(u.id) + '"> <span>' + esc(u.name) + ' <span class="auto-note">(' + esc(u.program) + ')</span></span></label>';
          }).join("") : '<div class="auto-note" style="padding:8px 0;">No approved students yet.</div>') + '</div>' +
          '<div class="field-label" style="margin:12px 0 6px;">Or type names yourself:</div>' +
          '<div id="clrManual"></div>' +
          '<button type="button" class="btn btn-ghost small" id="clrAdd">' + I.plus(13) + ' Add another student</button>' +
          '<div class="clr-letter" id="clrLetter"></div>' +
          '<div class="upload-error" id="clrError" style="display:none;"></div>' +
        '</div>' +
        '<div class="modal-foot split"><button type="button" class="btn btn-ghost small" data-close>Close</button>' +
          '<button type="button" class="btn btn-ghost small" id="clrDownload">' + I.download(13) + ' Download</button>' +
          '<button type="button" class="btn btn-red small" id="clrDone">' + I.circleCheck(13) + ' Done</button></div>' +
      '</div></div>');
    $all("[data-close]", m.el).forEach(function (b) { b.addEventListener("click", m.close); });
    var err = m.$("#clrError");
    function showErr(t) { err.style.display = "block"; err.textContent = t; }
    function picked() {
      return $all(".clr-pick", m.el).filter(function (c) { return c.checked; }).map(function (c) {
        return students.filter(function (u) { return u.id === c.value; })[0];
      }).filter(Boolean);
    }
    function typedNames() {
      return manual.map(function (n) { return n.replace(/\s+/g, " ").trim(); }).filter(Boolean);
    }
    function allNames() { return picked().map(function (u) { return u.name; }).concat(typedNames()); }
    function paint() {
      var names = allNames();
      m.$("#clrLetter").innerHTML = names.length
        ? '<div>The following <b>' + names.length + '</b> student' + (names.length === 1 ? "" : "s") + ' have been cleared for their Capstone / Research Hardbound</div><ol>' +
            names.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join("") + '</ol>' +
            '<div class="clr-sign"><b>Cecilia Q. Nacpil</b>Head, Library Services</div>'
        : '<div class="auto-note">Tick students above or type names, and the clearance letter appears here.</div>';
    }
    function paintManual() {
      m.$("#clrManual").innerHTML = manual.map(function (n, i) {
        return '<div class="clr-manual-row"><span class="auto-note">' + (picked().length + i + 1) + '.</span>' +
          '<input class="input" data-mi="' + i + '" placeholder="Type student name" maxlength="60" value="' + esc(n) + '">' +
          '<button type="button" class="btn btn-ghost small" data-mrm="' + i + '" aria-label="Remove student" title="Remove student">' + I.minus(13) + '</button></div>';
      }).join("");
      $all("[data-mi]", m.el).forEach(function (inp) {
        inp.addEventListener("input", function () { manual[+inp.dataset.mi] = inp.value; err.style.display = "none"; paint(); });
      });
      $all("[data-mrm]", m.el).forEach(function (b) {
        b.addEventListener("click", function () { manual.splice(+b.dataset.mrm, 1); paintManual(); paint(); });
      });
    }
    $all(".clr-pick", m.el).forEach(function (c) { c.addEventListener("change", function () { err.style.display = "none"; paintManual(); paint(); }); });
    m.$("#clrAdd").addEventListener("click", function () {
      if (manual.length >= 50) return showErr("That is the most names for one letter.");
      manual.push(""); paintManual(); paint();
      var rows = $all("[data-mi]", m.el); if (rows.length) rows[rows.length - 1].focus();
    });
    function checkTyped() {
      var typed = typedNames();
      for (var i = 0; i < typed.length; i++) {
        var v = D.validateName(typed[i]);
        if (!v.ok) { showErr("“" + typed[i] + "”: " + v.message); return false; }
        if (D.textProblem(typed[i])) { showErr("“" + typed[i] + "” isn't allowed. Please change it."); return false; }
      }
      return true;
    }
    paintManual(); paint();
    m.$("#clrDownload").addEventListener("click", function () {
      var names = allNames();
      if (!names.length) return showErr("Choose or type at least one student first.");
      if (!checkTyped()) return;
      var blob = buildPdf(clearanceBlocks(names));
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = "Release-Clearance-" + new Date().toISOString().slice(0, 10) + ".pdf";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
    m.$("#clrDone").addEventListener("click", function () {
      var list = picked(), typed = typedNames();
      if (!list.length && !typed.length) return showErr("Choose or type at least one student first.");
      if (!checkTyped()) return;
      var note = typed.length ? " " + typed.length + " typed name" + (typed.length === 1 ? " has" : "s have") + " no account, so no message was sent for " + (typed.length === 1 ? "it." : "them.") : "";
      if (!list.length) { m.close(); window.alert("Done." + note); return; }
      var btn = m.$("#clrDone"); btn.disabled = true;
      D.releaseClearance(list.map(function (u) { return u.id; })).then(function (res) {
        if (!res.ok) { btn.disabled = false; return showErr(res.message); }
        m.close();
        window.alert("Done. " + res.count + " student" + (res.count === 1 ? " was" : "s were") + " told their clearance was accepted." + note);
        render();
      });
    });
  }

  /** Wires every file / notice / revision button inside `app`.
   *  ctx: { me, render, tried } — `tried` stops the "mark as read" step from looping. */
  function wireCommon(app, ctx) {
    var me = ctx.me, render = ctx.render, staff = me.role !== "user";
    $all("[data-open-file]", app).forEach(function (b) {
      b.addEventListener("click", function () { var hit = findFile(b.dataset.openFile); if (hit) openViewer(hit); });
    });
    $all("[data-download-file]", app).forEach(function (b) {
      b.addEventListener("click", function () { var hit = findFile(b.dataset.downloadFile); downloadFile(b.dataset.downloadFile, hit ? hit.upload.name : "file"); });
    });
    $all("[data-progress-file]", app).forEach(function (b) {
      b.addEventListener("click", function () { var hit = findFile(b.dataset.progressFile); if (hit) openReviewModal(hit, { progressOnly: true }); });
    });
    $all("[data-open-card]", app).forEach(function (card) {
      function go() { var hit = findFile(card.dataset.openCard); if (hit) openFilePopup(hit, me, render); }
      card.addEventListener("click", go);
      card.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
    $all("[data-review-file]", app).forEach(function (b) {
      b.addEventListener("click", function () { var hit = findFile(b.dataset.reviewFile); if (hit) openReviewModal(hit); });
    });
    $all("[data-revise-file]", app).forEach(function (b) {
      b.addEventListener("click", function () {
        var hit = findFile(b.dataset.reviseFile); if (!hit) return;
        openComposeModal({ me: me, mode: "revision", studentId: hit.owner.id, fileId: hit.upload.id, fileName: hit.upload.name }, render);
      });
    });
    $all("[data-delete-file]", app).forEach(function (b) {
      b.addEventListener("click", function () {
        var hit = findFile(b.dataset.deleteFile); if (!hit) return;
        openComposeModal({ me: me, mode: "delete", studentId: hit.owner.id, fileId: hit.upload.id, fileName: hit.upload.name }, render);
      });
    });
    $all("[data-delete-student]", app).forEach(function (b) {
      if (!staff) return;
      b.addEventListener("click", function () {
        var u = D.getDB().users.filter(function (x) { return x.id === b.dataset.deleteStudent; })[0];
        if (u) openDeleteConfirm({ kind: "Student", name: u.name, onYes: function () { return D.deleteStudent(u.id); }, after: render });
      });
    });
    $all("[data-delete-teacher]", app).forEach(function (b) {
      if (me.role !== "superadmin") return;
      b.addEventListener("click", function () {
        var u = D.getDB().users.filter(function (x) { return x.id === b.dataset.deleteTeacher; })[0];
        if (u) openDeleteConfirm({ kind: "Teacher", name: u.name, onYes: function () { return D.deleteTeacher(u.id); }, after: render });
      });
    });
    $all("[data-view-deleted]", app).forEach(function (b) {
      if (me.role === "superadmin") b.addEventListener("click", openDeletedModal);
    });
    $all("[data-release-clearance]", app).forEach(function (b) {
      if (me.role === "superadmin") b.addEventListener("click", function () { openClearanceModal(me, render); });
    });
    $all("[data-revise-student]", app).forEach(function (b) {
      b.addEventListener("click", function () { openComposeModal({ me: me, mode: "revision", studentId: b.dataset.reviseStudent }, render); });
    });
    $all("[data-remove-own]", app).forEach(function (b) {
      b.addEventListener("click", function () {
        var hit = findFile(b.dataset.removeOwn); if (!hit) return;
        if (!window.confirm("Remove “" + hit.upload.name + "”? Your Teacher and Admin will be told, and you can then upload a different file.")) return;
        b.disabled = true;
        runAction(D.removeMine(hit.upload.id), render);
      });
    });
    $all("[data-read-note]", app).forEach(function (b) {
      b.addEventListener("click", function () {
        var n = D.getDB().notifications.filter(function (x) { return x.id === b.dataset.readNote; })[0];
        if (!n) return;
        openNoticeModal(n, me, function () { D.markNoticesSeen([n.id]).then(render); });
      });
    });
    $all("[data-remove-note]", app).forEach(function (b) {
      b.addEventListener("click", function () { b.disabled = true; runAction(D.removeNotice(b.dataset.removeNote), render); });
    });
    // opening the Notifications tab marks what's shown as read (revision/deleted notes the student still has to see in the pop-up are left alone)
    if (ctx.tab === "notifications") {
      var ids = D.getDB().notifications.filter(function (n) { return !n.seen && !(n.forPopup); }).map(function (n) { return n.id; })
        .filter(function (id) { return !ctx.tried[id]; });
      ids.forEach(function (id) { ctx.tried[id] = true; });
      if (ids.length) D.markNoticesSeen(ids).then(render);
    }
  }
  function unseenCount(notes) { return notes.filter(function (n) { return !n.seen; }).length; }

  /* ---------------------------------------------------------------------- */
  /* gallery — library view of every submitted Capstone/Thesis project,      */
  /* shared by the Admin and Teacher consoles                            */
  /* ---------------------------------------------------------------------- */
  function collectGalleryEntries(db) {
    var entries = [];
    db.users.filter(function (u) { return u.role === "user"; }).forEach(function (u) {
      u.tasks.forEach(function (t) {
        t.uploads.forEach(function (up) {
          entries.push({
            fileId: up.id, name: up.name, kind: up.kind, date: up.date, progress: up.progress, ownerId: u.id,
            student: u.name, program: u.program, taskTitle: t.title, taskId: t.id
          });
        });
      });
    });
    entries.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    return entries;
  }
  /** Same entry shape as collectGalleryEntries, but scoped to every APPROVED
   *  student in one program — this is what lets classmates in the same
   *  course see each other's submitted Capstone/Thesis files, instead of
   *  only their own. Pending/rejected accounts are excluded so students
   *  never see uploads tied to an account an Admin hasn't approved yet. */
  function collectCourseGalleryEntries(db, program) {
    var entries = [];
    db.users.filter(function (u) {
      return u.role === "user" && u.program === program && u.status === "approved";
    }).forEach(function (u) {
      u.tasks.forEach(function (t) {
        t.uploads.forEach(function (up) {
          entries.push({
            fileId: up.id, name: up.name, kind: up.kind, date: up.date, progress: up.progress, ownerId: u.id,
            student: u.name, program: u.program, taskTitle: t.title, taskId: t.id
          });
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
  function galleryGridHTML(entries, perms) {
    perms = perms || {};
    if (entries.length === 0) return emptyState("gallery", "No course projects match these filters.");
    return '<div class="gallery-grid">' + entries.map(function (e) {
      var isThesis = e.taskId === "thesis" || e.taskId === "certification";
      var accent = isThesis ? "var(--yellow-dark)" : "var(--red)";
      var up = { id: e.fileId, name: e.name, kind: e.kind };
      var staffCard = !!perms.staff;
      return (
        '<div class="gallery-card ' + (isThesis ? "type-thesis" : "type-capstone") + (staffCard ? " clickable" : "") + '"' +
          (staffCard ? ' data-open-card="' + esc(e.fileId) + '" tabindex="0" role="button" title="Tap to open"' : '') + '>' +
          '<div class="gallery-icon">' + kindIcon(e.kind, 20, accent) + '</div>' +
          '<div class="gallery-name" title="' + esc(e.name) + '">' + esc(e.name) + '</div>' +
          '<div class="gallery-meta">' + esc(e.student) + '</div>' +
          '<div class="gallery-tags">' +
            '<span class="tag-chip">' + esc(e.program) + '</span>' +
            '<span class="tag-chip">' + esc(e.taskTitle) + '</span>' +
          '</div>' +
          (e.kind === "image" ? "" : progressHTML(e.progress)) +
          '<div class="gallery-foot">' +
            '<span class="gallery-date">' + D.fmtDate(e.date) + '</span>' +
            (staffCard ? '<span class="auto-note">Tap to open</span>' : fileActionsHTML(up, { student: true })) +
          '</div>' +
        '</div>'
      );
    }).join("") + '</div>';
  }
  /** Teacher / Admin gallery: one folder per student (so a long class stays easy to scan). */
  function staffGalleryHTML(db, entries, state) {
    var groups = {}, order = [];
    entries.forEach(function (e) {
      if (!groups[e.ownerId]) { groups[e.ownerId] = []; order.push(e.ownerId); }
      groups[e.ownerId].push(e);
    });
    order.sort(function (x, y) { return groups[x][0].student.localeCompare(groups[y][0].student); });
    function owner(id) { return db.users.filter(function (u) { return u.id === id; })[0]; }
    if (state.folder && groups[state.folder]) {
      var list = groups[state.folder], o = owner(state.folder);
      return '<div class="folder-bar"><button type="button" class="btn btn-ghost small" data-folder-back>' + I.arrowLeft(13) + ' All folders</button>' +
        '<div class="folder-title">' + I.folder(16) + ' <b>' + esc(list[0].student) + '</b> <span class="tag-chip">' + esc(list[0].program) + '</span>' +
        ((o && o.tags) || []).filter(function (t) { return o && t !== o.program; }).map(function (t) { return pillHTML(t, "gray"); }).join("") + '</div></div>' +
        galleryGridHTML(list, { staff: true });
    }
    if (!order.length) return emptyState("gallery", "No course projects match these filters.");
    return '<div class="folder-grid">' + order.map(function (id) {
      var list = groups[id], o = owner(id), latest = list[0].date;   // entries are newest first
      var done = list.filter(function (e) { return e.progress !== null && e.progress >= 100; }).length;
      return '<button type="button" class="folder-card" data-open-folder="' + esc(id) + '">' +
        '<span class="folder-ico">' + I.folder(26) + '</span>' +
        '<span class="folder-name">' + esc(list[0].student) + '</span>' +
        '<span class="folder-meta"><span class="tag-chip">' + esc(list[0].program) + '</span>' +
          '<span>' + list.length + ' file' + (list.length === 1 ? "" : "s") + (done ? " · " + done + " completed" : "") + '</span></span>' +
        (o && o.tags && o.tags.filter(function (t) { return t !== o.program; }).length ? '<span class="folder-tags">' + o.tags.filter(function (t) { return t !== o.program; }).slice(0, 3).map(function (t) { return '<span class="tag-chip">' + I.tag(10) + esc(t) + '</span>'; }).join("") + '</span>' : "") +
        '<span class="folder-date">Updated ' + D.fmtDate(latest) + '</span>' +
      '</button>';
    }).join("") + '</div>';
  }
  function wireGalleryFilters(app, state, render) {
    $all("[data-open-folder]", app).forEach(function (b) { b.addEventListener("click", function () { state.folder = b.dataset.openFolder; render(); }); });
    $all("[data-folder-back]", app).forEach(function (b) { b.addEventListener("click", function () { state.folder = null; render(); }); });
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

    function render(msg) {
      var signinActive = state.mode === "signin";
      app.innerHTML =
        '<div class="login-shell">' +
          '<div class="brand-panel">' +
            '<div>' +
              '<div class="brand-mark"><div class="mark"><img src="' + assetPath("pup-logo.png") + '" alt="PUP seal" class="mark-img" /></div>' +
                '<span class="brand-eyebrow">CAMPUS RECORDS</span></div>' +
              '<h1 class="brand-title">Web based Thesis &amp; Capstone</h1>' +
              '<p class="brand-sub">Progress Monitoring System</p>' +
              '<p class="brand-copy">One filing system for Capstone and Thesis requirements — across BSIT, DIT, BSIE and BSBA.</p>' +
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
          emailComposeFieldHTML("fIdentifier", "Email", "yourname@gmail.com", state.identifier) +
          passwordFieldHTML("fPassword", "Password", "Enter your password", state.password) +
          '<button type="submit" class="btn btn-red" id="signinSubmit">' + I.login(15) + ' Log in</button>' +
        '</form>'
      );
    }
    function registerFormHTML() {
      return (
        '<form id="registerForm">' +
          '<label class="field"><div class="field-label">Full Name</div>' +
            '<input class="input" id="rName" placeholder="Dela Cruz, Juan" value="' + esc(state.rName) + '" maxlength="60" required></label>' +
          emailComposeFieldHTML("rEmail", "Email", "yourname@gmail.com", state.rEmail) +
          '<label class="field"><div class="field-label">Program</div>' +
            '<select class="input" id="rProgram">' + D.PROGRAMS.map(function (p) {
              return '<option value="' + p + '"' + (p === state.rProgram ? " selected" : "") + '>' + p + '</option>';
            }).join("") + '</select></label>' +
          passwordFieldHTML("rPassword", "Password", "Create a password", state.rPassword) +
          '<div class="msg hint">New accounts start as <b style="color:var(--ink)">view-only</b>. Your Teacher unlocks your Capstone and Thesis uploads after review.</div>' +
          '<button type="submit" class="btn btn-red" id="registerSubmit">' + I.userPlus(15) + ' Create Account</button>' +
        '</form>'
      );
    }

    function wire() {
      $all(".mode-btn").forEach(function (b) {
        b.addEventListener("click", function () { captureFormState(); state.mode = b.dataset.mode; render(null); });
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

      // blocked symbols are removed as they are typed (the @ of an email is kept)
      function filterField(id, isEmail) {
        var f = $("#" + id);
        if (!f) return;
        f.addEventListener("input", function () {
          var v = f.value, clean = D.stripBlocked(v, isEmail);
          if (clean !== v) f.value = clean;
        });
      }
      filterField("fIdentifier", true); filterField("rEmail", true);
      filterField("fPassword", false); filterField("rPassword", false);

      var signinForm = $("#signinForm");
      if (signinForm) signinForm.addEventListener("submit", function (e) {
        e.preventDefault();
        state.identifier = $("#fIdentifier").value;
        state.password = $("#fPassword").value;
        if (!state.consent) { render({ type: "error", text: "Please accept the Privacy Policy & Cookie Notice first." }); return; }
        var email = D.composeEmail(state.identifier);
        var btn = $("#signinSubmit");
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span> Logging in…'; }
        $all(".mode-btn").forEach(function (b) { b.disabled = true; });
        D.login(email, state.password).then(function (res) {
          if (!res.ok) { render({ type: "error", text: res.message }); return; }
          var dest = res.user.role === "user" ? "pages/userpage.html" : res.user.role === "admin" ? "pages/adminpage.html" : "pages/superadminpage.html";
          window.location.href = dest;
        });
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
        var btn = $("#registerSubmit");
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span> Creating account…'; }
        $all(".mode-btn").forEach(function (b) { b.disabled = true; });
        D.register({ name: name, email: email, program: program, password: password }).then(function (res) {
          if (!res.ok) { render({ type: "error", text: res.message }); return; }
          state.mode = "signin";
          state.identifier = email;
          state.password = "";
          state.rName = ""; state.rEmail = ""; state.rProgram = D.PROGRAMS[0]; state.rPassword = "";
          render({ type: "success", text: "Account filed as " + email + ". A Teacher or Admin will review and unlock your requirements." });
        });
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
    startIdleTimeout(user);
    var app = $("#app");
    app.innerHTML = skeletonDashboardHTML();
    var state = { tab: "projects", uploadErrors: {}, uploadingTask: null, uploadPhase: "", gallerySearch: "", galleryType: "", tried: {}, popupOpen: false, popupDone: {} };

    function render() {
      user = D.getCurrentUser(); // re-read in case Admin changed something
      if (!user) { window.location.href = pathToRoot() + "index.html"; return; }

      if (user.status === "pending") {
        var pendingNavItems = [{ key: "projects", label: "Course Projects", icon: "graduationCap" }];
        app.innerHTML =
          shellOpenHTML(user, "STUDENT RECORD", pendingNavItems, "projects", "narrow") +
          '<div class="fade-in">' +
            '<div class="card" style="text-align:center;padding:40px;border-top:4px solid var(--yellow);margin-top:8px;">' +
              I.clock(30, "var(--yellow-dark)") +
              '<h2 style="font-family:var(--font-display);font-size:20px;margin:14px 0 8px;">Awaiting Approval</h2>' +
              '<p style="color:var(--sub);font-size:14px;line-height:1.6;margin:0 0 18px;">' +
                'Your account for <b style="color:var(--ink)">' + esc(user.program) + '</b> was filed on ' + D.fmtDate(user.createdAt) + '. ' +
                'Once approved, your Capstone and Thesis course projects will appear here, view-only, until your Teacher unlocks uploads.' +
              '</p>' + statusChipHTML("pending") +
            '</div>' +
          '</div>' + shellCloseHTML();
        wireHeader();
        return;
      }

      var navItems = [
        { key: "projects", label: "Course Projects", icon: "graduationCap" },
        { key: "gallery", label: "Gallery", icon: "gallery" },
        { key: "notifications", label: "Notifications", icon: "bell", badge: unseenCount(D.getDB().notifications) || null }
      ];

      var unlockedCount = user.tasks.filter(function (t) { return t.unlocked; }).length;
      var uploadCount = user.tasks.reduce(function (n, t) { return n + t.uploads.length; }, 0);
      var lockedCount = user.tasks.length - unlockedCount;
      var maxMB = D.MAX_FILE_BYTES / 1024 / 1024;
      var maxImgMB = D.MAX_IMAGE_BYTES / 1024 / 1024;

      var body;
      if (state.tab === "gallery") {
        var courseEntries = collectCourseGalleryEntries(D.getDB(), user.program);
        var galleryEntries = filterGalleryEntries(courseEntries, state);
        body = panelHTML({
          icon: "gallery", iconAccent: "yellow", title: esc(user.program) + " Course Project Gallery",
          bodyHTML: galleryFilterBarHTML(state, { hideProgram: true }) + galleryGridHTML(galleryEntries, { staff: false })
        });
      } else if (state.tab === "notifications") {
        body = notificationsTabHTML(D.getDB().notifications);
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
          greetingHTML("Welcome back, " + firstName(user.name) + ".", "Here's where your course projects and required images stand.") +
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
                var hasFile = task.uploads.length > 0;
                var taskBody =
                  '<div style="font-size:12px;color:var(--sub);margin-bottom:12px;">Course: <span style="font-family:var(--font-mono);">' + esc(task.tag) + '</span></div>' +
                  (task.unlocked && !hasFile ?
                    '<label class="btn btn-primary small" style="cursor:pointer;' + (uploading ? "opacity:.6;pointer-events:none;" : "") + '">' +
                      (uploading ? '<span class="btn-spinner"></span> ' + esc(state.uploadPhase || "Working…") : I.upload(13) + ' Upload File') +
                      '<input type="file" accept="' + (task.imageOnly ? ".jpg,.jpeg,.png,.webp" : ".pdf,.ppt,.pptx,.doc,.docx") + '" data-task="' + task.id + '" style="display:none" ' + (uploading ? "disabled" : "") + ' /></label>' +
                    (task.imageOnly
                      ? '<div class="hint-small">One image only (JPG, PNG or WebP), up to ' + maxImgMB + 'MB. You can remove it and upload another.</div>'
                      : '<div class="hint-small">PDF, PowerPoint or Word only (no images) — one file per requirement, up to ' + maxMB + 'MB.</div>') +
                    (err ? '<div class="upload-error">' + I.alertTriangle(12) + ' ' + esc(err) + '</div>' : '')
                    : task.unlocked ? '<div class="hint-small" style="margin-top:0;">One file per requirement. Remove it (trash icon) to upload a different one.</div>'
                    : '<div style="font-size:12px;color:var(--sub);font-style:italic;">Locked by your Teacher — view only.</div>') +
                  '<div style="margin-top:12px;">' + fileListHTML(task.uploads, { own: task.unlocked || hasFile }) + '</div>';
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
      wireGalleryFilters(app, state, render);
      $all(".side-link").forEach(function (b) { b.addEventListener("click", function () { state.tab = b.dataset.tab; render(); }); });
      wireCommon(app, { me: user, render: render, tab: state.tab, tried: state.tried });
      $all('input[type="file"]').forEach(function (input) {
        input.addEventListener("change", function () {
          var f = input.files && input.files[0];
          var taskId = input.dataset.task;
          if (!f) return;

          var check = D.validateUploadFile(f, taskId);
          if (!check.ok) {
            state.uploadErrors[taskId] = check.message;
            render();
            return;
          }
          delete state.uploadErrors[taskId];
          state.uploadingTask = taskId;
          state.uploadPhase = "Checking your file…";
          render();

          var fail = function (msg) { state.uploadingTask = null; state.uploadErrors[taskId] = msg; render(); };
          var A = window.Analyzer;
          var isImageTask = check.kind === "image";
          (A ? (isImageTask ? A.inspectImage(f) : A.inspect(f)) : Promise.resolve({ ok: true })).then(function (info) {
            if (!info.ok) return fail(info.message);
            return (A && info.buffer && !isImageTask ? A.analyze(info) : Promise.resolve(null)).then(function (analysis) {
              state.uploadPhase = "Uploading…";
              render();
              return D.uploadFile(user.id, taskId, f, analysis).then(function (res) {
                state.uploadingTask = null;
                if (!res.ok) state.uploadErrors[taskId] = res.message;
                render();
              });
            });
          }).catch(function (e) { fail((e && e.message) || "Couldn't check that file."); });
        });
      });
      showPendingPopup();
    }

    /** A revision notice (or a "file deleted" note) pops up once; closing it marks it as read. */
    function showPendingPopup() {
      if (state.popupOpen) return;
      var n = D.getDB().notifications.filter(function (x) {
        return !x.seen && (x.kind === "revision" || x.kind === "deleted" || x.kind === "clearance") && !state.popupDone[x.id];
      }).sort(function (a, b) { return new Date(a.date) - new Date(b.date); })[0];
      if (!n) return;
      state.popupOpen = true;
      state.popupDone[n.id] = true;
      openNoticeModal(n, user, function () {
        D.markNoticesSeen([n.id]).then(function () { state.popupOpen = false; render(); });
      });
    }

    render();
    watch(render);
  }

  /* ============================================================================
     ADMINPAGE.HTML
     ============================================================================ */
  function initAdminPage() {
    var user = guardRole("admin");
    if (!user) return;
    startIdleTimeout(user);
    var app = $("#app");
    app.innerHTML = skeletonDashboardHTML();
    var state = { tab: "pending", open: {}, folder: null, tagDraft: {}, tagErrors: {}, search: "", gallerySearch: "", galleryProgram: "", galleryType: "", tried: {} };

    function render() {
      var db = D.getDB();
      var students = db.users.filter(function (u) { return u.role === "user"; });
      var pending = students.filter(function (u) { return u.status === "pending"; });
      var approved = students.filter(function (u) { return u.status === "approved"; });
      var notifications = db.notifications;
      var totalUploads = students.reduce(function (n, s) { return n + s.tasks.reduce(function (m, t) { return m + t.uploads.length; }, 0); }, 0);

      var q = state.search.trim().toLowerCase();
      var approvedFiltered = !q ? approved : approved.filter(function (u) {
        return u.name.toLowerCase().indexOf(q) !== -1 || u.program.toLowerCase().indexOf(q) !== -1 || u.email.toLowerCase().indexOf(q) !== -1;
      });

      var navItems = [
        { key: "pending", label: "New Registrations", icon: "bell", badge: pending.length || null },
        { key: "manage", label: "Manage Students", icon: "users" },
        { key: "gallery", label: "Gallery", icon: "gallery" },
        { key: "notifications", label: "Notifications", icon: "bell", badge: unseenCount(notifications) || null }
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
          var isOpen = !!state.open[u.id];
          var taskRows = u.tasks.map(function (t) {
            return [
              '<b>' + esc(t.title) + '</b>',
              '<button class="btn small ' + (t.unlocked ? "btn-red" : "btn-ghost") + '" data-toggle-task="' + u.id + '|' + t.id + '">' +
                (t.unlocked ? I.unlock(12) + " Unlocked" : I.lock(12) + " Locked") + '</button>',
              fileListHTML(t.uploads, { staff: true })
            ];
          });
          var prog = u.tasks.filter(function (t) { return !t.imageOnly; }).map(function (t) {
            var up = t.uploads[0];
            return '<span class="stu-pg">' + esc(t.title.split(" ")[0]) + ' <b>' + (up ? (up.progress === null ? "—" : up.progress + "%") : "—") + '</b></span>';
          }).join("");
          var files = u.tasks.reduce(function (n, t) { return n + t.uploads.length; }, 0);
          var bodyHTML = !isOpen ? "" :
            '<div class="stu-body">' +
              '<div style="display:flex;justify-content:flex-end;margin-bottom:10px;">' + courseSelectHTML(u.id, u.program) + '</div>' +
              '<div style="display:flex;gap:6px;margin-bottom:4px;">' +
                '<input class="input" style="width:100%;" placeholder="Add tag (e.g. Ready for Defense)" data-tag-input="' + u.id + '" value="' + esc(state.tagDraft[u.id] || "") + '" maxlength="40">' +
                '<button class="btn btn-ghost small" data-add-tag="' + u.id + '">' + I.plus(13) + '</button>' +
              '</div>' +
              (state.tagErrors[u.id] ? '<div class="upload-error" style="margin-bottom:8px;">' + I.alertTriangle(12) + ' ' + esc(state.tagErrors[u.id]) + '</div>' : '') +
              '<div class="stu-table">' + zebraTableHTML(["Project", "Access", "Files"], taskRows, "graduationCap", "No course projects.") + '</div>' +
            '</div>';
          return '<div class="stu-row' + (isOpen ? " open" : "") + '">' +
            '<div class="stu-head" data-toggle-student="' + u.id + '" role="button" tabindex="0" aria-expanded="' + isOpen + '">' +
              '<span class="stu-avatar">' + I.circleUser(18) + '</span>' +
              '<div class="stu-main"><div class="stu-name">' + esc(u.name) + '</div>' +
                '<div class="stu-sub">' + esc(u.email) + ' · Filed ' + D.fmtDate(u.createdAt) + ' · ' + files + ' file' + (files === 1 ? "" : "s") + '</div>' +
                '<div class="stu-tags"><span class="tag-chip">' + esc(u.program) + '</span>' + u.tags.filter(function (t) { return t !== u.program; }).map(function (t) { return pillHTML(t, "gray"); }).join("") + '</div></div>' +
              '<div class="stu-prog">' + prog + '</div>' +
              '<div class="stu-actions">' +
                '<button type="button" class="btn btn-red small" data-revise-student="' + u.id + '">' + I.send(12) + ' Revision</button>' +
                '<button type="button" class="btn btn-danger small" data-delete-student="' + u.id + '" title="Delete student" aria-label="Delete student">' + I.trash(13) + '</button>' +
              '</div>' +
              '<span class="stu-chev">' + I.chevronDown(16) + '</span>' +
            '</div>' + bodyHTML +
          '</div>';
        });
        body =
          '<div class="search-box">' + I.search(15) + '<input class="input" id="studentSearch" placeholder="Search by name, program or email…" value="' + esc(state.search) + '"></div>' +
          (approved.length === 0
            ? emptyState("users", "No approved students yet.")
            : approvedFiltered.length === 0
              ? emptyState("search", "No students match your search.")
              : '<div class="stu-list">' + studentPanels.join("") + '</div>');
      } else if (state.tab === "gallery") {
        var galleryEntries = filterGalleryEntries(collectGalleryEntries(db), state);
        body = panelHTML({
          icon: "gallery", iconAccent: "yellow", title: "Course Project Gallery",
          extraHTML: pillHTML(galleryEntries.length + " files", "gray"),
          bodyHTML: galleryFilterBarHTML(state) + staffGalleryHTML(db, galleryEntries, state)
        });
      } else {
        body = notificationsTabHTML(notifications);
      }

      app.innerHTML =
        shellOpenHTML(user, "TEACHER CONSOLE", navItems, state.tab, "wide") +
        '<div class="tab-body fade-in">' + body + '</div>' +
        shellCloseHTML();

      wireHeader();
      wireCommon(app, { me: user, render: render, tab: state.tab, tried: state.tried });
      wireGalleryFilters(app, state, render);
      $all(".side-link").forEach(function (b) { b.addEventListener("click", function () { state.tab = b.dataset.tab; render(); }); });
      $all("[data-approve]").forEach(function (b) { b.addEventListener("click", function () { b.disabled = true; runAction(D.approveUser(b.dataset.approve), render); }); });
      $all("[data-reject]").forEach(function (b) {
        b.addEventListener("click", function () {
          if (!window.confirm("Reject this registration? Their account will be deleted and they can register again.")) return;
          b.disabled = true;
          runAction(D.rejectUser(b.dataset.reject), render);
        });
      });
      $all("[data-program-select]").forEach(function (sel) {
        sel.addEventListener("change", function () { sel.disabled = true; runAction(D.setUserProgram(sel.dataset.programSelect, sel.value), render); });
      });
      $all("[data-toggle-task]").forEach(function (b) {
        b.addEventListener("click", function () {
          var parts = b.dataset.toggleTask.split("|");
          var owner = D.getDB().users.find(function (u) { return u.id === parts[0]; });
          var t = owner && owner.tasks.find(function (t) { return t.id === parts[1]; });
          if (!t) { render(); return; }
          b.disabled = true;
          runAction(D.setTaskUnlocked(parts[0], parts[1], !t.unlocked), render);
        });
      });
      $all("[data-toggle-student]").forEach(function (h) {
        function flip(e) {
          if (e.target.closest && e.target.closest("button,select,input,a")) return;
          state.open[h.dataset.toggleStudent] = !state.open[h.dataset.toggleStudent]; render();
        }
        h.addEventListener("click", flip);
        h.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(e); } });
      });
      $all("[data-tag-input]").forEach(function (inp) {
        inp.addEventListener("input", function () { state.tagDraft[inp.dataset.tagInput] = inp.value; });
      });
      $all("[data-add-tag]").forEach(function (b) {
        b.addEventListener("click", function () {
          var uid = b.dataset.addTag;
          b.disabled = true;
          D.addTag(uid, state.tagDraft[uid] || "").then(function (res) {
            if (!res.ok) { state.tagErrors[uid] = res.message; render(); return; }
            delete state.tagErrors[uid];
            state.tagDraft[uid] = "";
            render();
          });
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

    render();
    watch(render);
  }

  /* ============================================================================
     SUPERADMINPAGE.HTML
     ============================================================================ */
  function initSuperAdminPage() {
    var user = guardRole("superadmin");
    if (!user) return;
    startIdleTimeout(user);
    var app = $("#app");
    app.innerHTML = skeletonDashboardHTML();
    var state = { tab: "admins", folder: null, form: { name: "", email: "", password: "" }, msg: null, search: "", gallerySearch: "", galleryProgram: "", galleryType: "", tried: {} };

    function render() {
      var db = D.getDB();
      var admins = db.users.filter(function (u) { return u.role === "admin"; });
      var activeAdmins = admins.filter(function (a) { return a.status === "active"; });
      var students = db.users.filter(function (u) { return u.role === "user"; });
      var pendingStudents = students.filter(function (s) { return s.status === "pending"; });
      var notifications = db.notifications;
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
        { key: "admins", label: "Teacher Accounts", icon: "shieldCheck" },
        { key: "progress", label: "Student Progress", icon: "graduationCap" },
        { key: "gallery", label: "Gallery", icon: "gallery" },
        { key: "notifications", label: "Notifications", icon: "bell", badge: unseenCount(notifications) || null }
      ];

      var greeting = greetingHTML("Welcome, " + firstName(user.name) + ".", "A system-wide view of teachers and student progress.") +
        statPanelHTML([
          { icon: "shieldCheck", num: activeAdmins.length, label: "ACTIVE TEACHERS", bg: "var(--red-soft)", fg: "var(--red)" },
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
              (a.status === "active" ? I.shieldAlert(12) + " Deactivate" : I.shieldCheck(12) + " Reactivate") + '</button> ' +
            '<button type="button" class="btn btn-danger small" data-delete-teacher="' + a.id + '" title="Delete teacher" aria-label="Delete teacher">' + I.trash(13) + '</button>'
          ];
        });
        var addAdminBody =
          (state.msg ? '<div class="msg ' + state.msg.type + '">' + esc(state.msg.text) + '</div>' : "") +
          '<form id="addAdminForm">' +
            '<label class="field"><div class="field-label">Full Name</div><input class="input" id="saName" value="' + esc(state.form.name) + '" maxlength="60"></label>' +
            emailComposeFieldHTML("saEmail", "Email", "teacher@gmail.com") +
            passwordFieldHTML("saPassword", "Temporary Password", "Create a password") +
            '<button type="submit" class="btn btn-red">' + I.plus(14) + ' Add Teacher</button>' +
          '</form>';
        body = greeting +
          '<div class="dash-grid cols-2-1">' +
            panelHTML({
              icon: "shieldCheck", title: "Teacher Accounts", flush: true,
              extraHTML: '<button type="button" class="btn btn-ghost small" data-view-deleted style="margin-right:8px;">' + I.trash(13) + ' Recently Deleted</button>' + pillHTML(activeAdmins.length + " active", "green"),
              bodyHTML: zebraTableHTML(["Teacher", "Filed", "Status", ""], adminRows, "shieldCheck", "No teacher accounts yet.")
            }) +
            panelHTML({ icon: "plus", iconAccent: "red", title: "Add Teacher Account", bodyHTML: addAdminBody }) +
          '</div>';
      } else if (state.tab === "progress") {
        var progressRows = studentsFiltered.map(function (s) {
          var uploadCount = s.tasks.reduce(function (n, t) { return n + t.uploads.length; }, 0);
          return [
            '<b>' + esc(s.name) + '</b>', esc(s.program), statusPillHTML(s.status),
            '<span style="font-family:var(--font-mono);font-size:11.5px;color:var(--sub);">' + D.fmtDate(s.createdAt) + '</span>',
            String(uploadCount),
            s.tasks.filter(function (t) { return !t.imageOnly; }).map(function (t) {
              var up = t.uploads[0];
              return '<div style="font-size:11.5px;white-space:nowrap;">' + esc(t.title) + ': ' + (up ? (up.progress === null ? "not scored" : up.progress + "%" + (up.progress >= 100 ? " ✓ completed" : "")) : "—") + '</div>';
            }).join(""),
            '<div style="display:flex;gap:6px;align-items:center;">' +
              (s.status === "approved" ? '<button type="button" class="btn btn-red small" data-revise-student="' + s.id + '">' + I.send(12) + ' Revision</button>' : "") +
              '<button type="button" class="btn btn-danger small" data-delete-student="' + s.id + '" title="Delete student" aria-label="Delete student">' + I.trash(13) + '</button>' +
            '</div>'
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
            icon: "search", title: "All Students", flush: true,
            extraHTML: '<button type="button" class="btn btn-red small" data-release-clearance style="margin-right:8px;">' + I.circleCheck(13) + ' Release Clearance</button>' +
              '<button type="button" class="btn btn-ghost small" data-view-deleted style="margin-right:8px;" title="Recently deleted">' + I.trash(13) + '</button>' +
              '<input class="input" id="progressSearch" style="width:220px;" placeholder="Search by name or program…" value="' + esc(state.search) + '">',
            bodyHTML: zebraTableHTML(["Name", "Program", "Status", "Filed", "Uploads", "Progress", ""], progressRows, "graduationCap", "No student accounts yet.")
          });
      } else if (state.tab === "gallery") {
        var galleryEntries = filterGalleryEntries(collectGalleryEntries(db), state);
        body = greeting + panelHTML({
          icon: "gallery", iconAccent: "yellow", title: "Course Project Gallery",
          extraHTML: pillHTML(galleryEntries.length + " files", "gray"),
          bodyHTML: galleryFilterBarHTML(state) + staffGalleryHTML(db, galleryEntries, state)
        });
      } else {
        body = greeting + notificationsTabHTML(notifications);
      }

      app.innerHTML =
        shellOpenHTML(user, "ADMIN CONSOLE", navItems, state.tab, "wide") +
        '<div class="tab-body fade-in">' + body + '</div>' +
        shellCloseHTML();

      wireHeader();
      wirePasswordToggles(app);
      wireCommon(app, { me: user, render: render, tab: state.tab, tried: state.tried });
      wireGalleryFilters(app, state, render);
      $all(".side-link").forEach(function (b) { b.addEventListener("click", function () { state.tab = b.dataset.tab; state.msg = null; render(); }); });
      $all("[data-toggle-admin]").forEach(function (b) {
        b.addEventListener("click", function () {
          var parts = b.dataset.toggleAdmin.split("|");
          b.disabled = true;
          runAction(D.setAdminStatus(parts[0], parts[1]), render);
        });
      });
      var form = $("#addAdminForm");
      if (form) form.addEventListener("submit", function (e) {
        e.preventDefault();
        var name = $("#saName").value.trim(), emailRaw = $("#saEmail").value.trim(), password = $("#saPassword").value;
        var email = D.composeEmail(emailRaw);
        var submitBtn = form.querySelector("button[type=submit]");
        if (submitBtn) submitBtn.disabled = true;
        D.createAdmin({ name: name, email: email, password: password }).then(function (res) {
          if (!res.ok) { state.msg = { type: "error", text: res.message }; render(); return; }
          state.form = { name: "", email: "", password: "" };
          state.msg = { type: "success", text: name + " added as Teacher (" + email + ")." };
          render();
        });
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

    render();
    watch(render);
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
  /* idle timeout: Student 1h30, Teacher 30 min, Admin 30 min                  */
  /* ---------------------------------------------------------------------- */
  var IDLE_MINUTES = { user: 90, admin: 30, superadmin: 30 };
  var ACTIVE_KEY = "wbtc-last-active";
  function startIdleTimeout(user) {
    var limit = (IDLE_MINUTES[user.role] || 30) * 60000;
    var last = Date.now(), lastWrite = 0, timer = null, ended = false;
    function store(v) { try { localStorage.setItem(ACTIVE_KEY, String(v)); } catch (e) { /* private mode: this tab only */ } }
    function stored() { try { return Number(localStorage.getItem(ACTIVE_KEY)) || 0; } catch (e) { return 0; } }
    function touch() {
      var now = Date.now();
      last = now;
      if (now - lastWrite > 5000) { lastWrite = now; store(now); }   // other open tabs share this, so activity anywhere counts
    }
    store(last);
    ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click", "wheel"].forEach(function (ev) {
      window.addEventListener(ev, touch, { passive: true, capture: true });
    });
    function expire() {
      if (ended) return;
      ended = true;
      window.__wbtcTimedOut = true;
      if (timer) clearInterval(timer);
      var label = D.roleLabel(user.role);
      var m = openModal(
        '<div class="modal-overlay"><div class="modal-card" role="alertdialog" aria-modal="true">' +
          '<div class="modal-head"><h3>' + I.clock(17) + ' Session timed out</h3></div>' +
          '<div class="modal-body form-body timeout-msg">' +
            '<p style="margin:0 0 10px;">This ' + esc(label) + ' has no activity. Your session has timed out, and your session will be saved and recorded.</p>' +
            '<div class="rev-auto">Thank you “<b>' + esc(usernameOf(user)) + '</b>” <span class="auto">(Automatic)</span></div>' +
            '<div class="rev-auto">Date: <b>' + esc(D.fmtDateTime(new Date().toISOString())) + '</b></div>' +
          '</div>' +
          '<div class="modal-foot"><button type="button" class="btn btn-primary small" id="timeoutClose">Close</button></div>' +
        '</div></div>');
      var leave = function () { window.location.href = pathToRoot() + "index.html"; };
      m.$("#timeoutClose").addEventListener("click", leave);
      D.logout().then(null, function () {});   // the session is closed right away; the notice stays until Close
    }
    function check() {
      if (ended) return;
      var latest = Math.max(last, stored());
      if (Date.now() - latest >= limit) expire();
    }
    timer = setInterval(check, 15000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) check(); });
    window.addEventListener("focus", check);
  }

  /* ---------------------------------------------------------------------- */
  /* router                                                                    */
  /* ---------------------------------------------------------------------- */
  /** Waits for a server action to finish, shows its error (if any), then redraws. */
  function runAction(promise, render) {
    promise.then(function (res) {
      if (res && res.ok === false && res.message) window.alert(res.message);
      render();
    });
  }
  /** Redraws the page when fresh server data arrives (other people's uploads,
   *  new registrations...). Sends the visitor to sign-in if their account is gone. */
  function watch(render) {
    D.onChange(function () {
      if (window.__wbtcTimedOut) return;
      if (!D.getCurrentUser()) { window.location.href = pathToRoot() + "index.html"; return; }
      render();
    });
  }
  function connectionErrorHTML(message) {
    return '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">' +
      '<div class="card" style="max-width:420px;text-align:center;padding:32px;">' +
        '<h2 style="font-family:var(--font-display);font-size:18px;margin:0 0 10px;">Can\'t reach the server</h2>' +
        '<p style="color:var(--sub);font-size:13.5px;line-height:1.6;margin:0 0 16px;">' + esc(message || "Please check your internet connection and try again.") + '</p>' +
        '<button type="button" class="btn btn-red" id="retryBtn">Try again</button>' +
      '</div></div>';
  }

  document.addEventListener("DOMContentLoaded", function () {
    var page = document.body.dataset.page;
    var app = $("#app");
    var start = page === "login" ? initLoginPage : page === "user" ? initUserPage :
                page === "admin" ? initAdminPage : page === "superadmin" ? initSuperAdminPage : null;
    if (!start) return;

    function boot() {
      if (page !== "login") app.innerHTML = skeletonDashboardHTML();
      // Load the current session and data from the server, then draw the page.
      D.init().then(start).catch(function (err) {
        console.error(err);
        app.innerHTML = connectionErrorHTML(err && err.message);
        var retry = $("#retryBtn");
        if (retry) retry.addEventListener("click", boot);
      });
    }
    boot();
  });
})();
