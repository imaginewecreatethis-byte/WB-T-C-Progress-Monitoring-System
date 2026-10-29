/* ============================================================================
   db.js — WB-T&C Progress Monitoring System
   Shared data layer for all pages. Talks to a real Supabase project
   (Postgres + Auth + Storage), so every student, admin and upload is shared
   between devices.

   How it stays compatible with script.js: after DB.init() finishes, the
   current data is held in memory, so DB.getDB() / DB.getCurrentUser() are
   still instant. Anything that WRITES (login, register, approve, upload...)
   is async and refreshes that in-memory copy when it finishes.
   ============================================================================ */
(function (global) {
  "use strict";

  /* ---- Supabase project (the anon/publishable key is meant to be public;
          what protects the data is Row Level Security in Supabase) ---- */
  var SUPABASE_URL = "https://lbsiwyuwbgafxqszupws.supabase.co";
  var SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxic2l3eXV3YmdhZnhxc3p1cHdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5OTUxNDksImV4cCI6MjEwNTU3MTE0OX0.JqjoNtfnP99jHIhxa3qEmebRjNsD3qw3e6byIb4Kg0A";
  var BUCKET = "submissions";

  var CONSENT_COOKIE = "wbtc_consent";
  var DEVICE_KEY = "wbtc-device-account-v1";
  var POLL_MS = 30000;

  var EMAIL_DOMAIN = "@pup.edu.ph";
  /** "jdelacruz" -> "jdelacruz@pup.edu.ph" (any typed domain is replaced). */
  function composeEmail(username) {
    username = (username || "").trim().toLowerCase();
    if (!username) return "";
    return username.split("@")[0] + EMAIL_DOMAIN;
  }

  /** Values stored in the database stay superadmin / admin / user; these are the names shown on screen. */
  var ROLE_LABELS = { superadmin: "Admin", admin: "Teacher", user: "Student" };
  function roleLabel(role) { return ROLE_LABELS[role] || "User"; }

  var PROGRAMS = ["BSIT", "DIT", "BSIE", "BSBA"];
  var TASK_DEFS = [
    { id: "capstone", title: "Capstone Project" },
    { id: "thesis", title: "Thesis" }
  ];

  var sb = null;
  function client() {
    if (sb) return sb;
    if (!global.supabase || !global.supabase.createClient) {
      throw new Error("The Supabase library didn't load. Check your internet connection and reload.");
    }
    sb = global.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return sb;
  }

  /* ---------------------------------------------------------------------- */
  /* file validation                                                         */
  /* ---------------------------------------------------------------------- */
  var MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB per file (free plan has 1GB total)

  // Documents only: PDF, Word, PowerPoint. Images (and anything else) are refused.
  var ALLOWED_FILE_TYPES = {
    pdf:  { exts: ["pdf"], mimes: ["application/pdf"] },
    pptx: { exts: ["ppt", "pptx"], mimes: ["application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"] },
    docx: { exts: ["doc", "docx"], mimes: ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] }
  };
  var IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff", "heic", "heif", "svg", "ico", "avif"];
  var CONTENT_TYPES = {
    pdf: "application/pdf", doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  };

  function fileExt(file) { return (file.name.split(".").pop() || "").toLowerCase(); }
  function classifyFile(file) {
    var ext = fileExt(file);
    for (var kind in ALLOWED_FILE_TYPES) {
      if (ALLOWED_FILE_TYPES[kind].exts.indexOf(ext) !== -1) return kind;
    }
    return null;
  }
  function validateUploadFile(file) {
    var ext = fileExt(file);
    if (IMAGE_EXTS.indexOf(ext) !== -1 || /^image\//i.test(file.type || "")) {
      return { ok: false, message: "Images can't be uploaded. Please upload a PDF, PowerPoint (.ppt/.pptx) or Word (.doc/.docx) file." };
    }
    if (file.size > MAX_FILE_BYTES) {
      return { ok: false, message: "That file is " + (Math.round(file.size / 1024 / 1024 * 10) / 10) + "MB — the limit here is " + (MAX_FILE_BYTES / 1024 / 1024) + "MB." };
    }
    if (file.size < 1) return { ok: false, message: "That file is empty." };
    var kind = classifyFile(file);
    if (!kind) {
      return { ok: false, message: "Only PDF, PowerPoint (.ppt/.pptx) or Word (.doc/.docx) files are allowed." };
    }
    if (file.type) {
      var allMimes = [].concat.apply([], Object.keys(ALLOWED_FILE_TYPES).map(function (k) { return ALLOWED_FILE_TYPES[k].mimes; }));
      if (allMimes.indexOf(file.type) === -1 && file.type !== "application/octet-stream") {
        return { ok: false, message: "This file's contents don't look like a " + kind.toUpperCase() + " — double-check you selected the right file." };
      }
    }
    return { ok: true, kind: kind };
  }

  /* ---------------------------------------------------------------------- */
  /* helpers                                                                 */
  /* ---------------------------------------------------------------------- */
  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }
  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function todayISO() { return new Date().toISOString(); }
  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function fmtDateTime(iso) {
    return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function fail(message) { return { ok: false, message: message }; }

  /* ---------------------------------------------------------------------- */
  /* input validation                                                        */
  /* ---------------------------------------------------------------------- */
  var NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ .,'-]{2,60}$/;
  var USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
  var TAG_RE = /^[A-Za-z0-9À-ÖØ-öø-ÿ .,'&/-]{1,40}$/;

  function validateName(name) {
    name = (name || "").trim().replace(/\s+/g, " ");
    if (!name) return fail("Name is required.");
    if (!NAME_RE.test(name)) {
      return fail("Name must be 2-60 characters, letters only (spaces, hyphens, apostrophes and periods are fine).");
    }
    return { ok: true, value: name };
  }
  function validateUsername(username) {
    username = (username || "").trim().toLowerCase().split("@")[0];
    if (!username) return fail("Username is required.");
    if (!USERNAME_RE.test(username)) {
      return fail("Username must be 3-30 characters: lowercase letters, numbers, dots, underscores or hyphens only.");
    }
    return { ok: true, value: username };
  }
  function validatePassword(password) {
    password = password || "";
    if (password.trim().length === 0) return fail("Password is required.");
    if (password.length < 6) return fail("Password must be at least 6 characters.");
    if (password.length > 64) return fail("Password must be under 64 characters.");
    return { ok: true, value: password };
  }
  function validateTag(tag) {
    tag = (tag || "").trim();
    if (!tag) return fail("Tag can't be empty.");
    if (!TAG_RE.test(tag)) {
      return fail("Tags can only use letters, numbers, spaces and basic punctuation ( - / & ' , . ), up to 40 characters.");
    }
    return { ok: true, value: tag };
  }

  /* ---------------------------------------------------------------------- */
  /* in-memory copy of the data (what getDB / getCurrentUser read)           */
  /* ---------------------------------------------------------------------- */
  var cache = { meId: null, users: [], notes: [], state: {}, signature: "" };
  var listeners = [];
  var pollTimer = null;

  function emptyCache() { cache = { meId: null, users: [], notes: [], state: {}, signature: "" }; }

  function buildUsers(profiles, submissions) {
    var subs = {};
    submissions.forEach(function (s) {
      subs[s.user_id] = subs[s.user_id] || {};
      (subs[s.user_id][s.task_id] = subs[s.user_id][s.task_id] || []).push({
        id: s.id, name: s.file_name, kind: s.file_kind, size: s.file_size,
        date: s.created_at, path: s.storage_path,
        progress: s.progress === null || s.progress === undefined ? null : s.progress,
        analysis: s.analysis || null
      });
    });
    return profiles.map(function (p) {
      var u = { id: p.id, role: p.role, name: p.name, email: p.email || "", status: p.status, createdAt: p.created_at };
      if (p.role === "user") {
        var unlocked = p.unlocked_tasks || [];
        u.program = p.program;
        u.tags = p.tags || [];
        u.tasks = TASK_DEFS.map(function (t) {
          var ups = (subs[p.id] && subs[p.id][t.id]) || [];
          ups.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
          return { id: t.id, title: t.title, tag: p.program, unlocked: unlocked.indexOf(t.id) !== -1, uploads: ups };
        });
      }
      return u;
    });
  }

  /** Reloads everything the signed-in user is allowed to see. Row Level
   *  Security decides what comes back: a student gets their own record plus
   *  approved classmates in the same program; staff get everyone.
   *  Resolves true when the data differs from what was held before. */
  async function refresh() {
    var c = client();
    var s = await c.auth.getSession();
    var session = s && s.data && s.data.session;
    if (!session) {
      emptyCache();
      return false;
    }
    var pr = await c.from("profiles").select("*").order("created_at", { ascending: true });
    if (pr.error) throw new Error(pr.error.message);
    var su = await c.from("submissions").select("*").order("created_at", { ascending: false });
    if (su.error) throw new Error(su.error.message);

    var nt = await c.from("notifications").select("*").order("created_at", { ascending: false }).limit(300);
    if (nt.error) throw new Error(nt.error.message);
    var ns = await c.from("notification_state").select("*");
    if (ns.error) throw new Error(ns.error.message);
    var state = {};
    ns.data.forEach(function (r) { state[r.notification_id] = { removed: !!r.removed }; });

    var signature = JSON.stringify([pr.data, su.data, nt.data, ns.data]);
    var changed = signature !== cache.signature;
    cache = { meId: session.user.id, users: buildUsers(pr.data, su.data), notes: nt.data, state: state, signature: signature };

    // Signed in but the profile is gone (e.g. an Admin rejected this registration)
    if (!getCurrentUser()) { await c.auth.signOut(); emptyCache(); return true; }
    return changed;
  }

  async function init() {
    await refresh();
    return true;
  }

  /** Register a function to run when fresh server data differs from what's on
   *  screen. Polls every 30s while the tab is visible and nothing is being typed. */
  function onChange(fn) {
    listeners.push(fn);
    if (pollTimer) return;
    pollTimer = setInterval(async function () {
      if (document.hidden) return;
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      try {
        if (await refresh()) listeners.forEach(function (f) { try { f(); } catch (e) {} });
      } catch (e) { /* offline blip — try again next tick */ }
    }, POLL_MS);
  }

  /** Notices for the signed-in person. Which rows come back is decided by
   *  Row Level Security; here we only drop the ones they removed and the
   *  student-facing copies that a sender's own list would otherwise repeat. */
  function buildNotifications() {
    var me = getCurrentUser();
    if (!me) return [];
    var staff = me.role === "admin" || me.role === "superadmin";
    return cache.notes.filter(function (n) {
      if (cache.state[n.id] && cache.state[n.id].removed) return false;
      if (staff && n.audience.length === 1 && n.audience[0] === "user") return false;
      return true;
    }).map(function (n) {
      return {
        id: n.id, kind: n.kind, message: n.message, body: n.body || "", date: n.created_at,
        studentId: n.student_id, studentName: n.student_name, studentUsername: n.student_username,
        fileName: n.file_name, taskId: n.task_id, actorUsername: n.actor_username, actorRole: n.actor_role,
        seen: !!cache.state[n.id],
        panel: (n.kind === "revision" || (n.kind === "deleted" && staff)) ? "revision" : "notification"
      };
    });
  }

  function getDB() {
    return { users: cache.users, notifications: buildNotifications() };
  }
  function getCurrentUser() {
    if (!cache.meId) return null;
    return cache.users.filter(function (u) { return u.id === cache.meId; })[0] || null;
  }

  /* ---------------------------------------------------------------------- */
  /* one-account-per-device (best effort)                                    */
  /* ---------------------------------------------------------------------- */
  function getDeviceAccount() { try { return localStorage.getItem(DEVICE_KEY); } catch (e) { return null; } }
  function setDeviceAccount(email) { try { localStorage.setItem(DEVICE_KEY, email); } catch (e) {} }
  function clearDeviceAccount() { try { localStorage.removeItem(DEVICE_KEY); } catch (e) {} }

  /* ---------------------------------------------------------------------- */
  /* auth                                                                     */
  /* ---------------------------------------------------------------------- */
  function authMessage(err) {
    var m = (err && err.message) || "Something went wrong.";
    if (/invalid login credentials/i.test(m)) return "No matching account. Check your username and password.";
    if (/email not confirmed/i.test(m)) return "This account's email isn't confirmed yet. The site owner needs to switch off \"Confirm email\" in Supabase (Authentication → Sign In / Providers → Email).";
    if (/already registered|already been registered/i.test(m)) return "That username is already taken.";
    if (/rate limit|too many/i.test(m)) return "Too many attempts. Please wait a minute and try again.";
    if (/failed to fetch|network|load failed/i.test(m)) return "Can't reach the server. Check your internet connection.";
    return m;
  }

  async function login(identifier, password) {
    try {
      var c = client();
      var r = await c.auth.signInWithPassword({ email: identifier, password: password });
      if (r.error) return fail(authMessage(r.error));
      await refresh();
      var me = getCurrentUser();
      if (!me) { await c.auth.signOut(); emptyCache(); return fail("This account no longer exists."); }
      if (me.status === "inactive") {
        await c.auth.signOut();
        emptyCache();
        return fail("This account has been deactivated by the Admin.");
      }
      return { ok: true, user: me };
    } catch (e) { return fail(authMessage(e)); }
  }
  async function logout() {
    try { await client().auth.signOut(); } catch (e) {}
    emptyCache();
  }

  async function rpc(name, args) {
    var r = await client().rpc(name, args);
    if (r.error) throw new Error(r.error.message);
    return r.data;
  }

  /** Student self-registration. Guards against duplicates three ways:
   *   1. one username  -> enforced by Supabase Auth itself
   *   2. one person    -> same name + same program can't register twice
   *                       (enforced by a unique index in the database)
   *   3. one device    -> this browser remembers the account it created
   *  (3) is a deterrent, not a lock: a different browser or cleared site
   *  data gets around it. 1 and 2 are enforced server-side. */
  async function register(data) {
    var nameCheck = validateName(data.name);
    if (!nameCheck.ok) return nameCheck;
    var userCheck = validateUsername(data.email);
    if (!userCheck.ok) return userCheck;
    var pwCheck = validatePassword(data.password);
    if (!pwCheck.ok) return pwCheck;
    if (PROGRAMS.indexOf(data.program) === -1) return fail("Choose a valid program.");
    var email = composeEmail(userCheck.value);

    try {
      var c = client();

      var deviceEmail = getDeviceAccount();
      if (deviceEmail) {
        if (await rpc("username_taken", { p_email: deviceEmail })) {
          return fail("This device already registered an account (" + deviceEmail.split("@")[0] + "). Please sign in with it instead of creating another.");
        }
        clearDeviceAccount(); // that account was rejected/removed — allow a fresh registration
      }

      if (await rpc("username_taken", { p_email: email })) return fail("That username is already taken.");
      if (await rpc("person_registered", { p_name: nameCheck.value, p_program: data.program })) {
        return fail("A student named " + nameCheck.value + " is already registered in " + data.program + ". If that's you, sign in; if you forgot your password, ask your Teacher or Admin.");
      }

      var r = await c.auth.signUp({
        email: email, password: pwCheck.value,
        options: { data: { name: nameCheck.value, program: data.program } }
      });
      if (r.error) {
        if (/database error/i.test(r.error.message)) return fail("A student with that name is already registered in " + data.program + ".");
        return fail(authMessage(r.error));
      }
      // signUp may have logged the new student in; the flow wants them to sign in themselves
      await c.auth.signOut();
      emptyCache();
      setDeviceAccount(email);
      return { ok: true };
    } catch (e) { return fail(authMessage(e)); }
  }

  /* ---------------------------------------------------------------------- */
  /* admin actions                                                            */
  /* ---------------------------------------------------------------------- */
  /** Update a profile row and confirm it actually changed (Row Level
   *  Security silently skips rows you aren't allowed to touch). */
  async function patchProfile(id, patch) {
    var r = await client().from("profiles").update(patch).eq("id", id).select();
    if (r.error) return fail(/duplicate|unique/i.test(r.error.message) ? "A student with that name is already registered in that program." : r.error.message);
    if (!r.data || !r.data.length) return fail("You don't have permission to change that account.");
    await refresh();
    return { ok: true };
  }
  function findUser(id) { return cache.users.filter(function (u) { return u.id === id; })[0]; }

  async function approveUser(userId) {
    try { return await patchProfile(userId, { status: "approved" }); } catch (e) { return fail(authMessage(e)); }
  }
  async function rejectUser(userId) {
    try { await rpc("reject_user", { target: userId }); await refresh(); return { ok: true }; }
    catch (e) { return fail(authMessage(e)); }
  }
  async function setTaskUnlocked(userId, taskId, unlocked) {
    var u = findUser(userId);
    if (!u) return fail("Student not found.");
    var next = u.tasks.filter(function (t) { return t.unlocked && t.id !== taskId; }).map(function (t) { return t.id; });
    if (unlocked) next.push(taskId);
    try { return await patchProfile(userId, { unlocked_tasks: next }); } catch (e) { return fail(authMessage(e)); }
  }
  async function addTag(userId, tag) {
    var check = validateTag(tag);
    if (!check.ok) return check;
    var u = findUser(userId);
    if (u && u.tags.indexOf(check.value) !== -1) return fail("That tag is already on this student.");
    try { return await patchProfile(userId, { tags: (u ? u.tags : []).concat([check.value]) }); } catch (e) { return fail(authMessage(e)); }
  }
  async function setUserProgram(userId, newProgram) {
    if (PROGRAMS.indexOf(newProgram) === -1) return fail("Choose a valid program.");
    var u = findUser(userId);
    if (!u) return fail("Student not found.");
    var tags = u.tags.map(function (t) { return t === u.program ? newProgram : t; });
    if (tags.indexOf(newProgram) === -1) tags = [newProgram].concat(tags);
    try { return await patchProfile(userId, { program: newProgram, tags: tags }); } catch (e) { return fail(authMessage(e)); }
  }

  /* ---------------------------------------------------------------------- */
  /* student action: upload                                                   */
  /* ---------------------------------------------------------------------- */
  /** file: the browser File object; analysis: the result of Analyzer.analyze().
   *  Stored in Supabase Storage under <user id>/<file id>.<ext>, with a matching
   *  row in `submissions`. Only ONE file is allowed per requirement. */
  async function uploadFile(userId, taskId, file, analysis) {
    var check = validateUploadFile(file);
    if (!check.ok) return check;
    var ext = fileExt(file);
    if (!CONTENT_TYPES[ext]) return fail("That file's extension isn't valid.");
    var me = findUser(userId);
    var task = me && me.tasks && me.tasks.filter(function (t) { return t.id === taskId; })[0];
    if (task && task.uploads.length) {
      return fail("You already have a file for " + task.title + ". Remove it first if you want to upload a different one.");
    }
    var id = uuid();
    var path = userId + "/" + id + "." + ext;
    var progress = analysis && typeof analysis.progress === "number" ? Math.max(0, Math.min(100, Math.round(analysis.progress))) : null;
    try {
      var c = client();
      var up = await c.storage.from(BUCKET).upload(path, file, { contentType: CONTENT_TYPES[ext], upsert: false });
      if (up.error) {
        return fail(/row-level security|violates/i.test(up.error.message)
          ? "Uploads aren't allowed yet. Wait for your Teacher to approve and unlock you."
          : "Upload failed: " + up.error.message);
      }
      var ins = await c.from("submissions").insert({
        id: id, user_id: userId, task_id: taskId, file_name: file.name.slice(0, 200),
        file_kind: check.kind, storage_path: path, file_size: file.size,
        progress: progress, analysis: analysis || null
      });
      if (ins.error) {
        await c.storage.from(BUCKET).remove([path]); // don't leave an orphan file behind
        if (/duplicate|unique/i.test(ins.error.message)) return fail("You already have a file for this requirement. Remove it first.");
        return fail(/row-level security/i.test(ins.error.message)
          ? "Uploads for this requirement are locked. Ask your Teacher to unlock it."
          : "Couldn't save the submission: " + ins.error.message);
      }
      await refresh();
      return { ok: true };
    } catch (e) { return fail(authMessage(e)); }
  }

  function findUpload(fileId) {
    var hit = null;
    cache.users.forEach(function (u) {
      (u.tasks || []).forEach(function (t) {
        t.uploads.forEach(function (up) { if (up.id === fileId) hit = { upload: up, owner: u, task: t }; });
      });
    });
    return hit;
  }

  /** The student removes their own file, or an Admin/Teacher deletes one
   *  (a note is then required and the student is told). */
  async function removeSubmission(fileId, note) {
    try {
      var path = await rpc("remove_submission", { p_id: fileId, p_note: note || null });
      if (path) { try { await client().storage.from(BUCKET).remove([path]); } catch (e) { /* stored copy cleaned up best-effort */ } }
      await refresh();
      return { ok: true };
    } catch (e) { return fail(authMessage(e)); }
  }
  function removeMine(fileId) { return removeSubmission(fileId, null); }

  /** Admin/Teacher: send a revision note to a student (optionally about one file). */
  async function sendRevision(studentId, body, fileId) {
    body = (body || "").trim();
    if (body.length < 3) return fail("Write your revision note first.");
    if (body.length > 1000) return fail("Keep the note under 1000 characters.");
    try {
      await rpc("send_revision", { p_student: studentId, p_body: body, p_submission: fileId || null });
      await refresh();
      return { ok: true };
    } catch (e) { return fail(authMessage(e)); }
  }

  /** Mark notices as read, or take them off my own list. Only my view changes. */
  async function setNoticeState(ids, removed) {
    ids = [].concat(ids || []).filter(Boolean);
    if (!ids.length || !cache.meId) return { ok: true };
    try {
      var rows = ids.map(function (id) { return { user_id: cache.meId, notification_id: id, removed: !!removed }; });
      var r = await client().from("notification_state").upsert(rows, { onConflict: "user_id,notification_id" });
      if (r.error) return fail(r.error.message);
      await refresh();
      return { ok: true };
    } catch (e) { return fail(authMessage(e)); }
  }
  function markNoticesSeen(ids) {
    // keep an existing "removed" flag untouched: only add rows that don't exist yet
    var fresh = [].concat(ids || []).filter(function (id) { return !cache.state[id]; });
    return fresh.length ? setNoticeState(fresh, false) : Promise.resolve({ ok: true });
  }
  function removeNotice(id) { return setNoticeState([id], true); }

  /** Temporary 5-minute link to open/download a stored file. */
  async function getFileUrl(fileId, downloadName) {
    var hit = findUpload(fileId);
    if (!hit) return null;
    try {
      var r = await client().storage.from(BUCKET).createSignedUrl(hit.upload.path, 300, downloadName ? { download: downloadName } : undefined);
      return r.error ? null : r.data.signedUrl;
    } catch (e) { return null; }
  }

  /* ---------------------------------------------------------------------- */
  /* super admin actions                                                      */
  /* ---------------------------------------------------------------------- */
  async function createAdmin(data) {
    var nameCheck = validateName(data.name);
    if (!nameCheck.ok) return nameCheck;
    var userCheck = validateUsername(data.email);
    if (!userCheck.ok) return userCheck;
    var pwCheck = validatePassword(data.password);
    if (!pwCheck.ok) return pwCheck;
    var email = composeEmail(userCheck.value);
    try {
      if (await rpc("username_taken", { p_email: email })) return fail("An account with that username already exists.");
      // A separate, non-persistent client signs the new account up, so the
      // Super Admin stays logged in as themselves.
      var tmp = global.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "wbtc-temp-signup" }
      });
      var r = await tmp.auth.signUp({ email: email, password: pwCheck.value, options: { data: { name: nameCheck.value } } });
      if (r.error) return fail(authMessage(r.error));
      var newId = r.data && r.data.user && r.data.user.id;
      if (!newId) return fail("Couldn't create that account.");
      var res = await patchProfile(newId, { role: "admin", status: "active", name: nameCheck.value, program: null });
      if (!res.ok) return fail("The login was created but couldn't be promoted to Teacher: " + res.message);
      return { ok: true };
    } catch (e) { return fail(authMessage(e)); }
  }
  async function setAdminStatus(adminId, status) {
    if (status !== "active" && status !== "inactive") return fail("Invalid status.");
    try { return await patchProfile(adminId, { status: status }); } catch (e) { return fail(authMessage(e)); }
  }

  /* ---------------------------------------------------------------------- */
  /* public API                                                               */
  /* ---------------------------------------------------------------------- */
  global.DB = {
    PROGRAMS: PROGRAMS,
    TASK_DEFS: TASK_DEFS,
    EMAIL_DOMAIN: EMAIL_DOMAIN,
    composeEmail: composeEmail,
    CONSENT_COOKIE: CONSENT_COOKIE,
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    init: init,
    onChange: onChange,
    getDB: getDB,
    login: login,
    logout: logout,
    getCurrentUser: getCurrentUser,
    register: register,
    approveUser: approveUser,
    rejectUser: rejectUser,
    setTaskUnlocked: setTaskUnlocked,
    addTag: addTag,
    setUserProgram: setUserProgram,
    uploadFile: uploadFile,
    removeSubmission: removeSubmission,
    removeMine: removeMine,
    sendRevision: sendRevision,
    markNoticesSeen: markNoticesSeen,
    removeNotice: removeNotice,
    roleLabel: roleLabel,
    ROLE_LABELS: ROLE_LABELS,
    getFileUrl: getFileUrl,
    validateUploadFile: validateUploadFile,
    validateName: validateName,
    validateUsername: validateUsername,
    validatePassword: validatePassword,
    validateTag: validateTag,
    createAdmin: createAdmin,
    setAdminStatus: setAdminStatus,
    fmtDate: fmtDate,
    fmtDateTime: fmtDateTime,
    todayISO: todayISO,
    uid: uid
  };
})(window);
