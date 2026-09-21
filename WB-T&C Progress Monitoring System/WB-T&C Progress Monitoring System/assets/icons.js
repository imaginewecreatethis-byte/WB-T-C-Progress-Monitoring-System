/* ============================================================================
   icons.js — small stroke-style icon set (no external icon font needed)
   Usage: ICONS.lock(16, "#C21E1E") -> returns an <svg> string
   ============================================================================ */
(function (global) {
  "use strict";

  function svg(paths, size, color) {
    size = size || 16;
    color = color || "currentColor";
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
  }

  global.ICONS = {
    lock: function (s, c) { return svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', s, c); },
    unlock: function (s, c) { return svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.8"/>', s, c); },
    upload: function (s, c) { return svg('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>', s, c); },
    bell: function (s, c) { return svg('<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 21a2 2 0 0 0 4 0"/>', s, c); },
    users: function (s, c) { return svg('<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><circle cx="17.5" cy="9" r="2.6"/><path d="M15 14.3c2.7.4 5.5 2.1 5.5 5.7"/>', s, c); },
    shieldCheck: function (s, c) { return svg('<path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z"/><path d="m9 12 2 2 4-4"/>', s, c); },
    shieldAlert: function (s, c) { return svg('<path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z"/><path d="M12 8v4"/><circle cx="12" cy="15.5" r=".6" fill="' + (c || 'currentColor') + '"/>', s, c); },
    logout: function (s, c) { return svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>', s, c); },
    login: function (s, c) { return svg('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/>', s, c); },
    userPlus: function (s, c) { return svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 3-5.8 6.5-5.8s6.5 2.2 6.5 5.8"/><path d="M19 8v6M22 11h-6"/>', s, c); },
    plus: function (s, c) { return svg('<path d="M12 5v14M5 12h14"/>', s, c); },
    check: function (s, c) { return svg('<path d="M4 12l6 6L20 6"/>', s, c); },
    x: function (s, c) { return svg('<path d="M6 6l12 12M18 6L6 18"/>', s, c); },
    clock: function (s, c) { return svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>', s, c); },
    fileText: function (s, c) { return svg('<path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h6M9 9h2"/>', s, c); },
    presentation: function (s, c) { return svg('<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20l3-4 3 4"/><path d="M3 9h18"/>', s, c); },
    fileSpreadsheet: function (s, c) { return svg('<path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/><path d="M8 13h8M8 17h8M12 13v6"/>', s, c); },
    tag: function (s, c) { return svg('<path d="M3 11.5V5a2 2 0 0 1 2-2h6.5L21 12.5 12.5 21 3 11.5z"/><circle cx="7.5" cy="7.5" r="1.3" fill="' + (c || 'currentColor') + '"/>', s, c); },
    graduationCap: function (s, c) { return svg('<path d="M2 8l10-4 10 4-10 4-10-4z"/><path d="M6 10v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/><path d="M22 8v6"/>', s, c); },
    clipboardList: function (s, c) { return svg('<rect x="6" y="4" width="12" height="17" rx="1.5"/><rect x="9" y="2.5" width="6" height="3" rx="1"/><path d="M9 11h6M9 14h6M9 17h4"/>', s, c); },
    circleUser: function (s, c) { return svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 19a6 6 0 0 1 11 0"/>', s, c); },
    badgeCheck: function (s, c) { return svg('<path d="M12 2l2.4 1.3 2.7-.3 1.2 2.4L21 6.6l-.3 2.7L22 12l-1.3 2.4.3 2.7-2.4 1.2-1.2 2.4-2.7-.3L12 22l-2.4-1.3-2.7.3-1.2-2.4L3 17.1l.3-2.7L2 12l1.3-2.4L3 6.9l2.4-1.2 1.2-2.4 2.7.3z"/><path d="m9 12 2 2 4-4"/>', s, c); },
    eye: function (s, c) { return svg('<path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>', s, c); },
    eyeOff: function (s, c) { return svg('<path d="M3 3l18 18"/><path d="M10.6 5.2A10.4 10.4 0 0 1 12 5c7 0 10.5 7 10.5 7a17.3 17.3 0 0 1-3.4 4.4M6.6 6.6C3.7 8.4 1.5 12 1.5 12s3.5 7 10.5 7a10.6 10.6 0 0 0 4.4-.9"/><path d="M9.5 9.9a3 3 0 0 0 4.2 4.2"/>', s, c); },
    cookie: function (s, c) { return svg('<path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-4-4 4 4 0 0 1-4-4 4 4 0 0 1-2-2z"/><circle cx="9" cy="13" r="1" fill="' + (c || 'currentColor') + '"/><circle cx="14" cy="16" r="1" fill="' + (c || 'currentColor') + '"/><circle cx="14.5" cy="10.5" r="1" fill="' + (c || 'currentColor') + '"/>', s, c); },
    search: function (s, c) { return svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>', s, c); },
    sparkle: function (s, c) { return svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>', s, c); },
    menu: function (s, c) { return svg('<path d="M4 6h16M4 12h16M4 18h16"/>', s, c); },
    chevronDown: function (s, c) { return svg('<path d="m6 9 6 6 6-6"/>', s, c); },
    download: function (s, c) { return svg('<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 19h16"/>', s, c); },
    alertTriangle: function (s, c) { return svg('<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".6" fill="' + (c || 'currentColor') + '"/>', s, c); },
    gallery: function (s, c) { return svg('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>', s, c); }
  };
})(window);
