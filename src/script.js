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
    return kind === "pptx" ? I.presentation(size, color) : I.fileText(size, color);
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

  /** The little icon buttons next to a file. perms: { staff, own } */
  function fileActionsHTML(up, perms) {
    perms = perms || {};
    var id = esc(up.id || "");
    return '<div class="file-actions">' +
      '<button type="button" class="file-view-btn" data-view-file="' + id + '" data-name="' + esc(up.name) + '" data-kind="' + esc(up.kind) + '" title="' + (up.kind === "pdf" ? "Open" : "Download") + '">' + I.download(13) + '</button>' +
      ((perms.staff || perms.own) ? '<button type="button" class="file-view-btn" data-review-file="' + id + '" title="Progress, layout and grammar review">' + I.search(13) + '</button>' : '') +
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
          '</div>' + progressHTML(u.progress) + '</div>';
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
  function openReviewModal(hit) {
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
    body += '<div class="review-note">' + esc(GRAMMAR_NOTE) + '</div>';
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
          '<div class="rev-auto">Thank you “<b>' + esc(usernameOf(me)) + '</b>” <span class="auto">(Automatic)</span></div>' +
          '<div class="rev-auto">Date: <b>' + esc(today) + '</b> <span class="auto">(Automatic)</span></div>' +
          '<div class="upload-error" id="cmError" style="display:none;"></div>' +
        '</div>' +
        '<div class="modal-foot split"><button type="button" class="btn btn-ghost small" data-close>Close</button>' +
          '<button type="button" class="btn ' + (del ? "btn-danger" : "btn-red") + ' small" id="cmSend">' + (del ? I.trash(13) + " Delete &amp; send" : I.send(13) + " Send") + '</button></div>' +
      '</div></div>');
    $all("[data-close]", m.el).forEach(function (b) { b.addEventListener("click", m.close); });
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
    var head = isStaff
      ? (n.kind === "deleted" ? "File deleted" : "Revision notice sent") + (n.studentName ? ' — ' + n.studentName : "")
      : from;
    var m = openModal(
      '<div class="modal-overlay"><div class="modal-card wide" role="dialog" aria-modal="true">' +
        '<div class="modal-head"><h3>' + I.messageSquare(17) + ' ' + (n.kind === "deleted" ? "File deleted" : "Revision notice") + '</h3><button type="button" class="modal-close" data-close aria-label="Close">' + I.x(18) + '</button></div>' +
        '<div class="modal-body form-body">' +
          '<div class="rev-from">' + esc(head) + '</div>' +
          (n.fileName ? '<div class="rev-line">' + (n.kind === "deleted" ? "File name deletion: " : "About file: ") + '<b>' + esc(n.fileName) + '</b></div>' : "") +
          '<div class="rev-note">' + esc(n.body || n.message) + '</div>' +
          (isStaff ? "" : '<div class="rev-auto">Thank you “<b>' + esc(usernameOf(me)) + '</b>” <span class="auto">(Automatic)</span></div>') +
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

  /** Wires every file / notice / revision button inside `app`.
   *  ctx: { me, render, tried } — `tried` stops the "mark as read" step from looping. */
  function wireCommon(app, ctx) {
    var me = ctx.me, render = ctx.render, staff = me.role !== "user";
    $all("[data-view-file]", app).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var isPdf = btn.dataset.kind === "pdf";
        // Open the tab right away (inside the click) so popup blockers allow it
        var win = isPdf ? window.open("", "_blank") : null;
        D.getFileUrl(btn.dataset.viewFile, isPdf ? undefined : (btn.dataset.name || "file")).then(function (url) {
          if (url) { if (win) win.location.href = url; else window.location.href = url; }
          else {
            if (win) win.close();
            window.alert("Couldn't open that file. It may have been removed, or you may not have access to it.");
          }
        });
      });
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
      var isThesis = e.taskId === "thesis";
      var accent = isThesis ? "var(--yellow-dark)" : "var(--red)";
      var up = { id: e.fileId, name: e.name, kind: e.kind };
      return (
        '<div class="gallery-card ' + (isThesis ? "type-thesis" : "type-capstone") + '">' +
          '<div class="gallery-icon">' + kindIcon(e.kind, 20, accent) + '</div>' +
          '<div class="gallery-name" title="' + esc(e.name) + '">' + esc(e.name) + '</div>' +
          '<div class="gallery-meta">' + esc(e.student) + '</div>' +
          '<div class="gallery-tags">' +
            '<span class="tag-chip">' + esc(e.program) + '</span>' +
            '<span class="tag-chip">' + esc(e.taskTitle) + '</span>' +
          '</div>' +
          progressHTML(e.progress) +
          '<div class="gallery-foot">' +
            '<span class="gallery-date">' + D.fmtDate(e.date) + '</span>' +
            fileActionsHTML(up, { staff: !!perms.staff, own: false, review: false }) +
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
          emailComposeFieldHTML("fIdentifier", "PUP Email", "yourname", state.identifier) +
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
          emailComposeFieldHTML("rEmail", "PUP Email", "juandelacruz", state.rEmail) +
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
          state.identifier = email.split("@")[0];
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
                var hasFile = task.uploads.length > 0;
                var taskBody =
                  '<div style="font-size:12px;color:var(--sub);margin-bottom:12px;">Course: <span style="font-family:var(--font-mono);">' + esc(task.tag) + '</span></div>' +
                  (task.unlocked && !hasFile ?
                    '<label class="btn btn-primary small" style="cursor:pointer;' + (uploading ? "opacity:.6;pointer-events:none;" : "") + '">' +
                      (uploading ? '<span class="btn-spinner"></span> ' + esc(state.uploadPhase || "Working…") : I.upload(13) + ' Upload File') +
                      '<input type="file" accept=".pdf,.ppt,.pptx,.doc,.docx" data-task="' + task.id + '" style="display:none" ' + (uploading ? "disabled" : "") + ' /></label>' +
                    '<div class="hint-small">PDF, PowerPoint or Word only (no images) — one file per requirement, up to ' + maxMB + 'MB.</div>' +
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

          var check = D.validateUploadFile(f);
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
          (A ? A.inspect(f) : Promise.resolve({ ok: true })).then(function (info) {
            if (!info.ok) return fail(info.message);
            return (A && info.buffer ? A.analyze(info) : Promise.resolve(null)).then(function (analysis) {
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
        return !x.seen && (x.kind === "revision" || x.kind === "deleted") && !state.popupDone[x.id];
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
    var app = $("#app");
    app.innerHTML = skeletonDashboardHTML();
    var state = { tab: "pending", tagDraft: {}, tagErrors: {}, search: "", gallerySearch: "", galleryProgram: "", galleryType: "", tried: {} };

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
          var taskRows = u.tasks.map(function (t) {
            return [
              '<b>' + esc(t.title) + '</b>',
              '<button class="btn small ' + (t.unlocked ? "btn-red" : "btn-ghost") + '" data-toggle-task="' + u.id + '|' + t.id + '">' +
                (t.unlocked ? I.unlock(12) + " Unlocked" : I.lock(12) + " Locked") + '</button>',
              fileListHTML(t.uploads, { staff: true })
            ];
          });
          var studentBody =
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px;flex-wrap:wrap;">' +
              '<div style="font-size:11.5px;color:var(--sub);">' + esc(u.email) + ' · Filed ' + D.fmtDate(u.createdAt) + '</div>' +
              '<div style="display:flex;gap:6px;align-items:center;">' + courseSelectHTML(u.id, u.program) +
                '<button type="button" class="btn btn-red small" data-revise-student="' + u.id + '">' + I.send(12) + ' Revision</button></div>' +
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
          bodyHTML: galleryFilterBarHTML(state) + galleryGridHTML(galleryEntries, { staff: true })
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
    var app = $("#app");
    app.innerHTML = skeletonDashboardHTML();
    var state = { tab: "admins", form: { name: "", email: "", password: "" }, msg: null, search: "", gallerySearch: "", galleryProgram: "", galleryType: "", tried: {} };

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
              (a.status === "active" ? I.shieldAlert(12) + " Deactivate" : I.shieldCheck(12) + " Reactivate") + '</button>'
          ];
        });
        var addAdminBody =
          (state.msg ? '<div class="msg ' + state.msg.type + '">' + esc(state.msg.text) + '</div>' : "") +
          '<form id="addAdminForm">' +
            '<label class="field"><div class="field-label">Full Name</div><input class="input" id="saName" value="' + esc(state.form.name) + '" maxlength="60"></label>' +
            emailComposeFieldHTML("saEmail", "PUP Email", "migreyes") +
            passwordFieldHTML("saPassword", "Temporary Password", "Create a password") +
            '<button type="submit" class="btn btn-red">' + I.plus(14) + ' Add Teacher</button>' +
          '</form>';
        body = greeting +
          '<div class="dash-grid cols-2-1">' +
            panelHTML({
              icon: "shieldCheck", title: "Teacher Accounts", flush: true,
              extraHTML: pillHTML(activeAdmins.length + " active", "green"),
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
            s.tasks.map(function (t) {
              var up = t.uploads[0];
              return '<div style="font-size:11.5px;white-space:nowrap;">' + esc(t.title) + ': ' + (up ? (up.progress === null ? "not scored" : up.progress + "%" + (up.progress >= 100 ? " ✓ completed" : "")) : "—") + '</div>';
            }).join(""),
            s.status === "approved" ? '<button type="button" class="btn btn-red small" data-revise-student="' + s.id + '">' + I.send(12) + ' Revision</button>' : ""
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
            extraHTML: '<input class="input" id="progressSearch" style="width:220px;" placeholder="Search by name or program…" value="' + esc(state.search) + '">',
            bodyHTML: zebraTableHTML(["Name", "Program", "Status", "Filed", "Uploads", "Progress", ""], progressRows, "graduationCap", "No student accounts yet.")
          });
      } else if (state.tab === "gallery") {
        var galleryEntries = filterGalleryEntries(collectGalleryEntries(db), state);
        body = greeting + panelHTML({
          icon: "gallery", iconAccent: "yellow", title: "Course Project Gallery",
          extraHTML: pillHTML(galleryEntries.length + " files", "gray"),
          bodyHTML: galleryFilterBarHTML(state) + galleryGridHTML(galleryEntries, { staff: true })
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
