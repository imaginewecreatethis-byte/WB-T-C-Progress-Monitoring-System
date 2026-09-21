/* ============================================================================
   db.js — WB-T&C Progress Monitoring System
   Shared data layer for all three pages (userpage, adminpage, superadminpage).
   Acts as the "backend": every page reads/writes through this one file, so
   Admin actions taken on adminpage.html are immediately visible on
   userpage.html and superadminpage.html.
   ============================================================================ */
(function (global) {
  "use strict";

  var DB_KEY = "wbtc-portal-db-v1";
  var SESSION_KEY = "wbtc-portal-session-v1";
  var CONSENT_COOKIE = "wbtc_consent";

  var EMAIL_DOMAIN = "@pup.edu.ph";
  /** Turns a typed username into a full PUP email, e.g. "jdelacruz" -> "jdelacruz@pup.edu.ph".
   *  If the person already typed a full address, only the local part is kept and the
   *  official domain is reattached — every account in this system is a PUP account. */
  function composeEmail(username) {
    username = (username || "").trim().toLowerCase();
    if (!username) return "";
    var local = username.split("@")[0];
    return local + EMAIL_DOMAIN;
  }

  var PROGRAMS = ["BSIT", "DIT", "BSIE", "BSBA"];
  var TASK_DEFS = [
    { id: "capstone", title: "Capstone Project" },
    { id: "thesis", title: "Thesis" }
  ];

  /* ---------------------------------------------------------------------- */
  /* file uploads — validation + storage                                     */
  /* ---------------------------------------------------------------------- */
  // Files live under their own localStorage keys ("wbtc-file:<id>"), separate
  // from the main DB blob — so re-saving DB (approving a student, toggling a
  // lock, etc.) never has to re-write megabytes of file data along with it.
  var FILE_PREFIX = "wbtc-file:";
  // localStorage is small (commonly ~5MB total per site) and this is a
  // client-only prototype with no real server, so uploads are capped modestly.
  var MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB per file

  var ALLOWED_FILE_TYPES = {
    pdf: { exts: ["pdf"], mimes: ["application/pdf"] },
    pptx: { exts: ["ppt", "pptx"], mimes: ["application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"] },
    xlsx: { exts: ["xls", "xlsx"], mimes: ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] }
  };

  function classifyFile(file) {
    var ext = (file.name.split(".").pop() || "").toLowerCase();
    for (var kind in ALLOWED_FILE_TYPES) {
      if (ALLOWED_FILE_TYPES[kind].exts.indexOf(ext) !== -1) return kind;
    }
    return null;
  }
  /** Validates a File (or a plain {name,size,type} object) before it's read.
   *  Checks: is it actually a Capstone/Thesis-acceptable type (by extension,
   *  cross-checked against the browser-reported MIME type when available),
   *  and is it under the size limit this prototype can actually store. */
  function validateUploadFile(file) {
    if (file.size > MAX_FILE_BYTES) {
      return { ok: false, message: "That file is " + (Math.round(file.size / 1024 / 1024 * 10) / 10) + "MB — the limit here is " + (MAX_FILE_BYTES / 1024 / 1024) + "MB." };
    }
    var kind = classifyFile(file);
    if (!kind) {
      return { ok: false, message: "Only PDF, PPT/PPTX, or XLS/XLSX files are accepted for Capstone and Thesis submissions." };
    }
    if (file.type) {
      var allMimes = [].concat.apply([], Object.keys(ALLOWED_FILE_TYPES).map(function (k) { return ALLOWED_FILE_TYPES[k].mimes; }));
      // Some browsers/OSes report a generic "application/octet-stream" for
      // legitimate files, so that one's exempted rather than rejected outright.
      if (allMimes.indexOf(file.type) === -1 && file.type !== "application/octet-stream") {
        return { ok: false, message: "This file's contents don't look like a " + kind.toUpperCase() + " — double-check you selected the right file." };
      }
    }
    return { ok: true, kind: kind };
  }

  function saveFileData(fileId, dataUrl) {
    try {
      localStorage.setItem(FILE_PREFIX + fileId, dataUrl);
      return true;
    } catch (e) {
      console.error("db.js file storage error:", e);
      return false;
    }
  }
  /** Reads back a stored file's data URL, e.g. to open/download it. Returns
   *  null for legacy demo records that predate real file storage. */
  function getFileDataUrl(fileId) {
    if (!fileId) return null;
    try { return localStorage.getItem(FILE_PREFIX + fileId); } catch (e) { return null; }
  }

  /* ---------------------------------------------------------------------- */
  /* helpers                                                                 */
  /* ---------------------------------------------------------------------- */
  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }
  function todayISO() { return new Date().toISOString(); }
  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function fmtDateTime(iso) {
    return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  /* ---------------------------------------------------------------------- */
  /* input validation — the authoritative rules every field must pass       */
  /* before it's allowed to touch storage. script.js calls these too, for   */
  /* instant on-screen feedback, but THIS is the layer that actually        */
  /* enforces them — so a field can never reach storage unvalidated even if */
  /* the UI check were skipped, disabled, or bypassed some other way.       */
  /* ---------------------------------------------------------------------- */
  var NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ .,'-]{2,60}$/;
  var USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
  var TAG_RE = /^[A-Za-z0-9À-ÖØ-öø-ÿ .,'&/-]{1,40}$/;

  function validateName(name) {
    name = (name || "").trim();
    if (!name) return { ok: false, message: "Name is required." };
    if (!NAME_RE.test(name)) {
      return { ok: false, message: "Name must be 2-60 characters, letters only (spaces, hyphens, apostrophes and periods are fine)." };
    }
    return { ok: true, value: name };
  }
  function validateUsername(username) {
    username = (username || "").trim().toLowerCase().split("@")[0];
    if (!username) return { ok: false, message: "Username is required." };
    if (!USERNAME_RE.test(username)) {
      return { ok: false, message: "Username must be 3-30 characters: lowercase letters, numbers, dots, underscores or hyphens only." };
    }
    return { ok: true, value: username };
  }
  function validatePassword(password) {
    password = password || "";
    if (password.trim().length === 0) return { ok: false, message: "Password is required." };
    if (password.length < 6) return { ok: false, message: "Password must be at least 6 characters." };
    if (password.length > 64) return { ok: false, message: "Password must be under 64 characters." };
    return { ok: true, value: password };
  }
  function validateTag(tag) {
    tag = (tag || "").trim();
    if (!tag) return { ok: false, message: "Tag can't be empty." };
    if (!TAG_RE.test(tag)) {
      return { ok: false, message: "Tags can only use letters, numbers, spaces and basic punctuation ( - / & ' , . ), up to 40 characters." };
    }
    return { ok: true, value: tag };
  }

  /* ---------------------------------------------------------------------- */
  /* seed data                                                                */
  /* ---------------------------------------------------------------------- */
  function daysAgoISO(n) { return new Date(Date.now() - n * 86400000).toISOString(); }

  function seed() {
    return {
      users: [
        { id: "sa1", role: "superadmin", name: "Dr. Elena Santos", email: "santos@pup.edu.ph",
          password: "super123", status: "active", createdAt: daysAgoISO(400) },
        { id: "ad1", role: "admin", name: "Prof. Miguel Reyes", email: "reyes@pup.edu.ph",
          password: "admin123", status: "active", createdAt: daysAgoISO(300) },
        { id: "u1", role: "user", name: "Juan Dela Cruz", email: "juan@pup.edu.ph",
          password: "user123", program: "BSIT", status: "approved", createdAt: daysAgoISO(12),
          tags: ["BSIT"],
          tasks: [
            { id: "capstone", title: "Capstone Project", tag: "BSIT", unlocked: true,
              uploads: [{ id: "seed_up1", name: "capstone_proposal_v1.pdf", kind: "pdf", date: daysAgoISO(3) }] },
            { id: "thesis", title: "Thesis", tag: "BSIT", unlocked: false, uploads: [] }
          ] },
        { id: "u2", role: "user", name: "Ana Lim", email: "ana@pup.edu.ph",
          password: "user123", program: "BSBA", status: "pending", createdAt: daysAgoISO(1),
          tags: ["BSBA"],
          tasks: [
            { id: "capstone", title: "Capstone Project", tag: "BSBA", unlocked: false, uploads: [] },
            { id: "thesis", title: "Thesis", tag: "BSBA", unlocked: false, uploads: [] }
          ] }
      ],
      notifications: [
        { id: uid("n"), forRoles: ["admin", "superadmin"], message: "Ana Lim (BSBA) registered a new account.", date: daysAgoISO(1) }
      ]
    };
  }

  /* ---------------------------------------------------------------------- */
  /* storage                                                                  */
  /* ---------------------------------------------------------------------- */
  function migrateStaleEmails(db) {
    var changed = false;
    db.users = db.users.map(function (u) {
      if (u.email && u.email.toLowerCase().indexOf("@campus.edu") !== -1) {
        changed = true;
        return Object.assign({}, u, { email: u.email.split("@")[0] + EMAIL_DOMAIN });
      }
      return u;
    });
    if (changed) save(db);
    return db;
  }

  /** Older records (from before real file storage existed) may have upload
   *  entries with no id — give them one so the view/download button works
   *  uniformly. These legacy entries just won't have real file data behind
   *  them (getFileDataUrl returns null for them), which the UI handles. */
  function migrateUploadIds(db) {
    var changed = false;
    db.users = db.users.map(function (u) {
      if (!u.tasks) return u;
      var tasks = u.tasks.map(function (t) {
        var uploads = t.uploads.map(function (up) {
          if (up.id) return up;
          changed = true;
          return Object.assign({}, up, { id: uid("legacy") });
        });
        return Object.assign({}, t, { uploads: uploads });
      });
      return Object.assign({}, u, { tasks: tasks });
    });
    if (changed) save(db);
    return db;
  }

  function load() {
    try {
      var raw = localStorage.getItem(DB_KEY);
      if (raw) return migrateUploadIds(migrateStaleEmails(JSON.parse(raw)));
    } catch (e) { /* fall through to seed */ }
    var fresh = seed();
    save(fresh);
    return fresh;
  }
  function save(db) {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      console.error("db.js storage error:", e);
      return false;
    }
  }

  function getSession() {
    try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; }
  }
  function setSession(id) {
    try { id ? localStorage.setItem(SESSION_KEY, id) : localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  /* ---------------------------------------------------------------------- */
  /* auth                                                                     */
  /* ---------------------------------------------------------------------- */
  function login(identifier, password) {
    var db = load();
    var match = db.users.find(function (u) {
      var idOk = u.email.toLowerCase() === identifier.toLowerCase() || u.name.toLowerCase() === identifier.toLowerCase();
      return idOk && u.password === password;
    });
    if (!match) return { ok: false, message: "No matching account. Check your email and password." };
    if (match.status === "inactive") return { ok: false, message: "This account has been deactivated by the Super Admin." };
    setSession(match.id);
    return { ok: true, user: match };
  }
  function logout() { setSession(null); }
  function getCurrentUser() {
    var id = getSession();
    if (!id) return null;
    var db = load();
    return db.users.find(function (u) { return u.id === id; }) || null;
  }

  function register(data) {
    var nameCheck = validateName(data.name);
    if (!nameCheck.ok) return nameCheck;
    var userCheck = validateUsername(data.email);
    if (!userCheck.ok) return userCheck;
    var pwCheck = validatePassword(data.password);
    if (!pwCheck.ok) return pwCheck;
    if (PROGRAMS.indexOf(data.program) === -1) return { ok: false, message: "Choose a valid program." };

    var db = load();
    var exists = db.users.some(function (u) { return u.email.toLowerCase() === data.email.toLowerCase(); });
    if (exists) return { ok: false, message: "An account with that email already exists." };
    var newUser = {
      id: uid("u"), role: "user", name: nameCheck.value, email: data.email, password: pwCheck.value,
      program: data.program, status: "pending", createdAt: todayISO(), tags: [data.program],
      tasks: TASK_DEFS.map(function (t) {
        return { id: t.id, title: t.title, tag: data.program, unlocked: false, uploads: [] };
      })
    };
    db.users.push(newUser);
    db.notifications.unshift({
      id: uid("n"), forRoles: ["admin", "superadmin"],
      message: newUser.name + " (" + newUser.program + ") registered a new account.",
      date: todayISO()
    });
    save(db);
    return { ok: true };
  }

  /* ---------------------------------------------------------------------- */
  /* admin actions                                                            */
  /* ---------------------------------------------------------------------- */
  function approveUser(userId) {
    var db = load();
    db.users = db.users.map(function (u) { return u.id === userId ? Object.assign({}, u, { status: "approved" }) : u; });
    save(db);
  }
  function rejectUser(userId) {
    var db = load();
    db.users = db.users.filter(function (u) { return u.id !== userId; });
    save(db);
  }
  function setTaskUnlocked(userId, taskId, unlocked) {
    var db = load();
    db.users = db.users.map(function (u) {
      if (u.id !== userId) return u;
      var tasks = u.tasks.map(function (t) { return t.id === taskId ? Object.assign({}, t, { unlocked: unlocked }) : t; });
      return Object.assign({}, u, { tasks: tasks });
    });
    save(db);
  }
  function addTag(userId, tag) {
    var check = validateTag(tag);
    if (!check.ok) return check;
    var db = load();
    var user = db.users.filter(function (u) { return u.id === userId; })[0];
    if (user && user.tags.indexOf(check.value) !== -1) return { ok: false, message: "That tag is already on this student." };
    db.users = db.users.map(function (u) {
      return u.id === userId ? Object.assign({}, u, { tags: u.tags.concat([check.value]) }) : u;
    });
    save(db);
    return { ok: true };
  }
  /** Admin reassigns a student to a different program/course. Updates the
   *  student's program, swaps the old program out of their tag list for the
   *  new one, and re-tags every course project task to match. */
  function setUserProgram(userId, newProgram) {
    if (PROGRAMS.indexOf(newProgram) === -1) return;
    var db = load();
    db.users = db.users.map(function (u) {
      if (u.id !== userId) return u;
      var oldProgram = u.program;
      var tags = u.tags.map(function (t) { return t === oldProgram ? newProgram : t; });
      if (tags.indexOf(newProgram) === -1) tags = [newProgram].concat(tags);
      var tasks = u.tasks.map(function (t) { return Object.assign({}, t, { tag: newProgram }); });
      return Object.assign({}, u, { program: newProgram, tags: tags, tasks: tasks });
    });
    save(db);
  }

  /* ---------------------------------------------------------------------- */
  /* user action                                                              */
  /* ---------------------------------------------------------------------- */
  /** fileMeta: { id, name, kind, size, dataUrl }. Persists the actual file
   *  content under its own storage key, then records only the metadata (not
   *  the content) against the task, so re-saving the DB for unrelated
   *  changes never has to shuttle megabytes of file data along with it. */
  function uploadFile(userId, taskId, fileMeta) {
    var stored = saveFileData(fileMeta.id, fileMeta.dataUrl);
    if (!stored) return { ok: false, message: "Storage is full — try a smaller file, or ask an Admin to clear old uploads." };
    var db = load();
    db.users = db.users.map(function (u) {
      if (u.id !== userId) return u;
      var tasks = u.tasks.map(function (t) {
        if (t.id !== taskId) return t;
        var entry = { id: fileMeta.id, name: fileMeta.name, kind: fileMeta.kind, size: fileMeta.size, date: todayISO() };
        return Object.assign({}, t, { uploads: [entry].concat(t.uploads) });
      });
      return Object.assign({}, u, { tasks: tasks });
    });
    save(db);
    return { ok: true };
  }

  /* ---------------------------------------------------------------------- */
  /* super admin actions                                                      */
  /* ---------------------------------------------------------------------- */
  function createAdmin(data) {
    var nameCheck = validateName(data.name);
    if (!nameCheck.ok) return nameCheck;
    var userCheck = validateUsername(data.email);
    if (!userCheck.ok) return userCheck;
    var pwCheck = validatePassword(data.password);
    if (!pwCheck.ok) return pwCheck;

    var db = load();
    var exists = db.users.some(function (u) { return u.email.toLowerCase() === data.email.toLowerCase(); });
    if (exists) return { ok: false, message: "An account with that email already exists." };
    db.users.push({ id: uid("ad"), role: "admin", name: nameCheck.value, email: data.email, password: pwCheck.value, status: "active", createdAt: todayISO() });
    save(db);
    return { ok: true };
  }
  function setAdminStatus(adminId, status) {
    var db = load();
    db.users = db.users.map(function (u) { return u.id === adminId ? Object.assign({}, u, { status: status }) : u; });
    save(db);
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
    getDB: load,
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
    validateUploadFile: validateUploadFile,
    validateName: validateName,
    validateUsername: validateUsername,
    validatePassword: validatePassword,
    validateTag: validateTag,
    getFileDataUrl: getFileDataUrl,
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    createAdmin: createAdmin,
    setAdminStatus: setAdminStatus,
    fmtDate: fmtDate,
    fmtDateTime: fmtDateTime,
    todayISO: todayISO,
    uid: uid
  };
})(window);
