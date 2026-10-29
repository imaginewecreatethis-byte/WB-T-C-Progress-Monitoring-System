/* ============================================================================
   analyzer.js — WB-T&C Progress Monitoring System
   Reads a student's PDF / Word / PowerPoint file IN THE BROWSER and produces:
     • a progress score (0-100%) based on which Capstone/Thesis sections it has
     • layout checks (fonts, headings, blank pages, small text ...)
     • basic grammar / writing checks
   Nothing is sent anywhere to be analysed: only the finished result (score and
   issue list) is saved with the file. The libraries it needs (JSZip, pdf.js)
   are loaded on demand, the first time a file is checked.

   These are automatic, rule-based checks. They catch common problems but they
   are not a replacement for proofreading, and they can be wrong.
   ============================================================================ */
(function (global) {
  "use strict";

  var JSZIP_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
  var JSZIP_SRI = "sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG";
  var PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/pdf.min.mjs";
  var PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/pdf.worker.min.mjs";

  var MAX_PDF_PAGES = 300;
  var MAX_ISSUES_SHOWN = 30;
  var MAX_PER_RULE = 8;
  var ANALYSIS_TIMEOUT_MS = 60000;

  var IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff", "heic", "heif", "svg", "ico", "avif"];
  var KIND_LABEL = { pdf: "PDF", docx: "Word", pptx: "PowerPoint" };

  /* ---------------------------------------------------------------------- */
  /* small helpers                                                           */
  /* ---------------------------------------------------------------------- */
  function extOf(name) { return (String(name || "").split(".").pop() || "").toLowerCase(); }
  function kindFromExt(ext) {
    if (ext === "pdf") return "pdf";
    if (ext === "doc" || ext === "docx") return "docx";
    if (ext === "ppt" || ext === "pptx") return "pptx";
    return null;
  }
  function wordCount(text) {
    var m = String(text || "").match(/[A-Za-z0-9À-ɏ][A-Za-z0-9À-ɏ'’-]*/g);
    return m ? m.length : 0;
  }
  function clip(text, n) {
    text = String(text || "").replace(/\s+/g, " ").trim();
    return text.length > n ? text.slice(0, n - 1) + "…" : text;
  }
  function around(text, index, length) {
    var start = Math.max(0, index - 28);
    var end = Math.min(text.length, index + length + 28);
    return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
  }
  function mode(list) {
    var counts = {}, best = null, bestN = 0;
    list.forEach(function (v) {
      var k = String(v);
      counts[k] = (counts[k] || 0) + 1;
      if (counts[k] > bestN) { bestN = counts[k]; best = v; }
    });
    return { value: best, count: bestN };
  }
  function median(nums) {
    if (!nums.length) return 0;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  function listNumbers(nums, max) {
    max = max || 8;
    var shown = nums.slice(0, max).join(", ");
    return nums.length > max ? shown + " and " + (nums.length - max) + " more" : shown;
  }
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error("timeout")); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* loading the helper libraries on demand                                  */
  /* ---------------------------------------------------------------------- */
  var jszipPromise = null, pdfjsPromise = null;

  function loadJSZip() {
    if (global.JSZip) return Promise.resolve(global.JSZip);
    if (jszipPromise) return jszipPromise;
    jszipPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = JSZIP_URL;
      s.integrity = JSZIP_SRI;
      s.crossOrigin = "anonymous";
      s.onload = function () { global.JSZip ? resolve(global.JSZip) : reject(new Error("JSZip missing")); };
      s.onerror = function () { jszipPromise = null; reject(new Error("Couldn't load the document reader. Check your internet connection.")); };
      document.head.appendChild(s);
    });
    return jszipPromise;
  }
  function loadPdfjs() {
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = import(PDFJS_URL).then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return lib;
    }).catch(function () {
      pdfjsPromise = null;
      throw new Error("Couldn't load the PDF reader. Check your internet connection.");
    });
    return pdfjsPromise;
  }

  /* ---------------------------------------------------------------------- */
  /* inspecting what a file REALLY is (not just what its name says)          */
  /* ---------------------------------------------------------------------- */
  function sniff(bytes) {
    var b = bytes, n = b.length;
    function at(i, arr) { for (var k = 0; k < arr.length; k++) { if (b[i + k] !== arr[k]) return false; } return true; }
    if (n >= 8 && at(0, [0x89, 0x50, 0x4E, 0x47])) return "image";
    if (n >= 3 && at(0, [0xFF, 0xD8, 0xFF])) return "image";
    if (n >= 4 && at(0, [0x47, 0x49, 0x46, 0x38])) return "image";            // GIF8
    if (n >= 2 && at(0, [0x42, 0x4D])) return "image";                         // BM
    if (n >= 12 && at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image"; // WEBP
    if (n >= 4 && (at(0, [0x49, 0x49, 0x2A, 0x00]) || at(0, [0x4D, 0x4D, 0x00, 0x2A]))) return "image"; // TIFF
    if (n >= 12 && at(4, [0x66, 0x74, 0x79, 0x70])) return "image";            // ftyp: HEIC / AVIF
    if (n >= 4 && at(0, [0x00, 0x00, 0x01, 0x00])) return "image";             // ICO
    var head = "";
    for (var i = 0; i < Math.min(n, 400); i++) head += String.fromCharCode(b[i]);
    if (/<svg[\s>]/i.test(head) || (/^\s*<\?xml/i.test(head) && /<svg/i.test(head))) return "image";
    var pdfHead = head.slice(0, 1024);
    if (pdfHead.indexOf("%PDF-") !== -1) return "pdf";
    if (n >= 4 && at(0, [0x50, 0x4B, 0x03, 0x04])) return "zip";
    if (n >= 8 && at(0, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])) return "ole";
    return "unknown";
  }
  function latin1(bytes) {
    var CH = 0x8000, out = [];
    for (var i = 0; i < bytes.length; i += CH) {
      out.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length))));
    }
    return out.join("");
  }
  function utf16(str) { return str.split("").join("\u0000"); }

  /** Looks inside the file. Resolves { ok, kind, buffer } or { ok:false, message }. */
  function inspect(file) {
    var ext = extOf(file.name);
    var kind = kindFromExt(ext);
    var imageMsg = "Images can’t be uploaded. Please upload a PDF, PowerPoint (.ppt/.pptx) or Word (.doc/.docx) file.";
    if (IMAGE_EXTS.indexOf(ext) !== -1 || /^image\//i.test(file.type || "")) return Promise.resolve({ ok: false, message: imageMsg });
    if (!kind) return Promise.resolve({ ok: false, message: "Only PDF, PowerPoint (.ppt/.pptx) or Word (.doc/.docx) files are allowed." });

    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onerror = function () { resolve({ ok: false, message: "Couldn’t read that file. Please try again." }); };
      reader.onload = function () {
        var buffer = reader.result;
        var bytes = new Uint8Array(buffer);
        var type = sniff(bytes);
        var bad = "This doesn’t look like a real " + KIND_LABEL[kind] + " file. Open it and use Save As / Export to " + KIND_LABEL[kind] + ", then upload that.";

        if (type === "image") return resolve({ ok: false, message: imageMsg });
        if (kind === "pdf") {
          return resolve(type === "pdf" ? { ok: true, kind: kind, ext: ext, buffer: buffer } : { ok: false, message: bad });
        }
        var s = latin1(bytes);
        if (ext === "docx" || ext === "pptx") {
          if (type === "ole") return resolve({ ok: false, message: "This file is password-protected or damaged. Remove the password, save it again, and upload it." });
          var inner = ext === "docx" ? "word/document.xml" : "ppt/presentation.xml";
          return resolve(type === "zip" && s.indexOf(inner) !== -1 ? { ok: true, kind: kind, ext: ext, buffer: buffer } : { ok: false, message: bad });
        }
        // legacy .doc / .ppt (binary Office)
        var marker = ext === "doc" ? "WordDocument" : "PowerPoint Document";
        return resolve(type === "ole" && s.indexOf(utf16(marker)) !== -1 ? { ok: true, kind: kind, ext: ext, buffer: buffer } : { ok: false, message: bad });
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /* ---------------------------------------------------------------------- */
  /* progress rubric — which sections a Capstone / Thesis should contain      */
  /* ---------------------------------------------------------------------- */
  var SECTIONS = [
    { id: "abstract", label: "Abstract", only: ["pdf", "docx"],
      re: /\b(abstract|executive summary)\b/ },
    { id: "intro", label: "Introduction / Background of the Study",
      re: /\b(introduction|background of the (study|project)|background and (rationale|context)|rationale of the study|project context|overview of the study)\b/ },
    { id: "problem", label: "Statement of the Problem / Objectives",
      re: /\b(statement of the problem|problem statement|statement of the objectives?|(general|specific) objectives?|objectives? of the (study|project)|research (questions?|objectives?)|purpose of the study)\b/ },
    { id: "scope", label: "Scope and Limitations",
      re: /\b(scope and (limitations?|delimitations?)|scope of the (study|project)|limitations? of the (study|project)|delimitations?)\b/ },
    { id: "rrl", label: "Review of Related Literature",
      re: /\b(review of (the )?(related )?(literature|studies|works?)|related (literature|studies|works?)|literature review|\brrl\b)\b/ },
    { id: "method", label: "Methodology",
      re: /\b(methodology|methods? of (the )?(study|research)|research (design|methodology|methods?)|(software|system) development (life ?cycle|model|methodology)|development methodology|requirements analysis)\b/ },
    { id: "results", label: "Results and Discussion",
      re: /\b(results?( and (discussion|analysis|interpretation))?|findings|presentation,? analysis|analysis and interpretation|discussion of (the )?results|system testing|testing and evaluation|evaluation results?)\b/ },
    { id: "conclusion", label: "Conclusion and Recommendations",
      re: /\b(conclusions?|recommendations?|summary of findings)\b/ },
    { id: "references", label: "References / Bibliography",
      re: /\b(references|bibliography|works cited|literature cited)\b/, minWords: 25, minWordsSlide: 4 }
  ];
  var MIN_WORDS = 40, MIN_WORDS_SLIDE = 8;

  function isTocLike(t) {
    if (/\.{3,}\s*\d+\s*$/.test(t) || /\s{3,}\d+\s*$/.test(t) || /\t\d+\s*$/.test(t)) return true;
    if (/\s\d{1,4}\s*$/.test(t) && !/^(chapter|part|section|appendix)\b/i.test(t) && !/^\d+(\.\d+)*[.)]?\s/.test(t) && !/\b(figure|table)\b/i.test(t)) return true;
    return false;
  }
  function isHeadingCandidate(t) {
    t = t.trim();
    if (!t || t.length > 120) return false;
    return wordCount(t) <= 14 && !isTocLike(t);
  }
  function matchedSection(text, kind) {
    var low = text.toLowerCase();
    for (var i = 0; i < SECTIONS.length; i++) {
      var s = SECTIONS[i];
      if (s.only && s.only.indexOf(kind) === -1) continue;
      if (s.re.test(low)) return s;
    }
    return null;
  }

  /** lines: [{ text, slide? }]. Returns the per-section result and the progress %. */
  function scoreSections(lines, kind) {
    var headIdx = []; // indexes of lines that look like a section heading
    lines.forEach(function (ln, i) {
      if (!ln.text) return;
      if (isHeadingCandidate(ln.text) && matchedSection(ln.text, kind)) headIdx.push(i);
    });
    var sections = [], total = 0, count = 0;
    SECTIONS.forEach(function (s) {
      if (s.only && s.only.indexOf(kind) === -1) return;
      var need = kind === "pptx" ? (s.minWordsSlide || MIN_WORDS_SLIDE) : (s.minWords || MIN_WORDS);
      var best = -1;
      headIdx.forEach(function (idx) {
        if (!s.re.test(lines[idx].text.toLowerCase())) return;
        var words = 0, j = idx + 1;
        var nextHead = headIdx.filter(function (h) { return h > idx; })[0];
        var stop = nextHead === undefined ? Math.min(lines.length, idx + 4000) : nextHead;
        for (; j < stop; j++) words += wordCount(lines[j].text);
        if (words > best) best = words;
      });
      var state = best < 0 ? "missing" : best >= need ? "found" : "thin";
      sections.push({ id: s.id, label: s.label, state: state });
      total += state === "found" ? 1 : state === "thin" ? 0.5 : 0;
      count++;
    });
    return { sections: sections, progress: count ? Math.round(total / count * 100) : 0 };
  }

  /* ---------------------------------------------------------------------- */
  /* grammar / writing checks                                                */
  /* ---------------------------------------------------------------------- */
  var MISSPELLED = {
    "alot": "a lot", "definately": "definitely", "definatly": "definitely", "recieve": "receive", "recieved": "received",
    "seperate": "separate", "seperately": "separately", "occured": "occurred", "occurence": "occurrence",
    "untill": "until", "wich": "which", "teh": "the", "thier": "their", "adress": "address",
    "enviroment": "environment", "goverment": "government", "accomodate": "accommodate", "becuase": "because",
    "begining": "beginning", "beleive": "believe", "calender": "calendar", "comming": "coming",
    "existance": "existence", "independant": "independent", "neccessary": "necessary", "necesary": "necessary",
    "persistant": "persistent", "privelege": "privilege", "publically": "publicly", "refering": "referring",
    "succesful": "successful", "sucessful": "successful", "succesfully": "successfully", "wierd": "weird",
    "writting": "writing", "algorithim": "algorithm", "databse": "database", "adminstrator": "administrator",
    "arguement": "argument", "assesment": "assessment", "buisness": "business", "catagory": "category",
    "concious": "conscious", "dependancy": "dependency", "developement": "development", "diffrent": "different",
    "efficency": "efficiency", "embarass": "embarrass", "evalution": "evaluation", "fufill": "fulfill",
    "garantee": "guarantee", "guidlines": "guidelines", "immediatly": "immediately", "implementaion": "implementation",
    "knowlege": "knowledge", "maintainance": "maintenance", "mispell": "misspell", "noticable": "noticeable",
    "oppurtunity": "opportunity", "paralel": "parallel", "percieve": "perceive", "posession": "possession",
    "prefered": "preferred", "proffesional": "professional", "recomend": "recommend", "reccomend": "recommend",
    "reccomendation": "recommendation", "relevent": "relevant", "responsability": "responsibility",
    "restaraunt": "restaurant", "scedule": "schedule", "sentance": "sentence", "similiar": "similar",
    "stategy": "strategy", "supercede": "supersede", "tommorow": "tomorrow", "truely": "truly",
    "usefull": "useful", "wether": "whether", "writen": "written", "acheive": "achieve", "acording": "according",
    "analize": "analyze", "apparantly": "apparently", "appearence": "appearance", "benifit": "benefit",
    "cheif": "chief", "completly": "completely", "consistant": "consistent", "convinient": "convenient",
    "dissapear": "disappear", "excercise": "exercise", "finaly": "finally", "foward": "forward", "freind": "friend",
    "happend": "happened", "heirarchy": "hierarchy", "intresting": "interesting", "libary": "library",
    "managment": "management", "milennium": "millennium", "mesage": "message", "occassion": "occasion",
    "pasword": "password", "peice": "piece", "performace": "performance", "seccond": "second", "thier's": "their",
    "transfered": "transferred", "useing": "using", "vaccum": "vacuum", "wellcome": "welcome", "yeild": "yield"
  };
  var MISSPELL_RE = new RegExp("\\b(" + Object.keys(MISSPELLED).join("|") + ")\\b", "gi");
  var ABBREV_BEFORE_PERIOD = /(?:\b(?:dr|mr|mrs|ms|prof|engr|fig|figs|eq|no|nos|vs|etc|inc|ltd|jr|sr|st|ph|approx|dept|univ|vol|al|cf|sec|ch|pp|p|e\.g|i\.e)|\b[A-Za-z])$/i;
  var A_AN_AN_EXC = /^(hour|hours|hourly|honest|honestly|honor|honors|honour|heir|heirs)$/i;

  /** chunks: [{ text, at, para? }]  where para=true means one real paragraph (Word). */
  function checkGrammar(chunks, kind) {
    var all = [], perRule = {}, total = 0;
    var seen = {};
    function add(rule, msg, ctx, at) {
      var key = rule + "|" + ctx;
      if (seen[key]) return;
      seen[key] = true;
      total++;
      perRule[rule] = (perRule[rule] || 0) + 1;
      if (perRule[rule] <= MAX_PER_RULE && all.length < 200) all.push({ rule: rule, msg: msg, ctx: ctx, at: at });
    }
    var spacingReliable = kind !== "pdf";

    chunks.forEach(function (ch) {
      var text = ch.text, at = ch.at, m;
      if (!text || wordCount(text) < 3) return;

      // repeated word
      var rep = /\b([A-Za-z]{2,})\s+\1\b/gi;
      while ((m = rep.exec(text))) {
        var w = m[1].toLowerCase();
        if (w === "had" || w === "that") continue;
        add("repeat", "Repeated word “" + m[1] + "”.", around(text, m.index, m[0].length), at);
      }
      // spelling list
      MISSPELL_RE.lastIndex = 0;
      while ((m = MISSPELL_RE.exec(text))) {
        add("spelling", "Possible misspelling: “" + m[1] + "” → “" + MISSPELLED[m[1].toLowerCase()] + "”.", around(text, m.index, m[0].length), at);
      }
      // common mix-ups
      var mix = [
        [/\b(should|could|would|must|might)\s+of\b/gi, function (x) { return "“" + x[0] + "” → “" + x[1] + " have”."; }],
        [/\btheir\s+(is|are|was|were)\b/gi, function (x) { return "“" + x[0] + "” → “there " + x[1] + "”."; }],
        [/\bit['’]s\s+own\b/gi, function () { return "“it’s own” → “its own”."; }],
        [/\ban\s+(uni\w*|use\w*|usu\w*|uti\w*|one|once|eu\w*)\b/gi, function (x) { return "“an " + x[1] + "” → “a " + x[1] + "”."; }]
      ];
      mix.forEach(function (pair) {
        pair[0].lastIndex = 0;
        while ((m = pair[0].exec(text))) add("mixup", "Check wording: " + pair[1](m), around(text, m.index, m[0].length), at);
      });
      // a / an
      var an = /\ba\s+([aeio][a-z]+)\b/g;
      while ((m = an.exec(text))) {
        if (/^(one|once)$/i.test(m[1])) continue;
        add("article", "Use “an” before “" + m[1] + "”.", around(text, m.index, m[0].length), at);
      }
      var an2 = /\ban\s+([bcdfgjklmnpqrstvwxyz][a-z]+)\b/g;
      while ((m = an2.exec(text))) {
        if (A_AN_AN_EXC.test(m[1])) continue;
        add("article", "Use “a” before “" + m[1] + "”.", around(text, m.index, m[0].length), at);
      }
      // subject-verb agreement (simple, common cases)
      var sv = /\b(students|users|respondents|participants|results|findings|researchers|teachers|systems|files|records)\s+(is|was|has)\b/gi;
      while ((m = sv.exec(text))) add("agreement", "Plural subject with singular verb — check “" + m[0] + "”.", around(text, m.index, m[0].length), at);
      var sv2 = /\b(the|this|that|a|an)\s+(system|student|user|study|project|application|software|website|database|process|module|researcher)\s+(are|were|have)\b/gi;
      while ((m = sv2.exec(text))) add("agreement", "Singular subject with plural verb — check “" + m[0] + "”.", around(text, m.index, m[0].length), at);
      // lowercase I
      var li = /(^|[\s(])i(?=\s+(?:am|was|were|have|had|will|would|can|could|think|believe|feel|want|need|do|did)\b|['’](?:m|ll|ve|d)\b)/g;
      while ((m = li.exec(text))) add("capital", "Capitalize the pronoun “I”.", around(text, m.index, m[0].length), at);
      // punctuation
      var pun = /[!?]{2,}|,{2,}|(?:[^.]|^)\.\.(?!\.)/g;
      while ((m = pun.exec(text))) add("punct", "Repeated punctuation.", around(text, m.index, m[0].length), at);
      var nospace = /\b[a-z]{2,}[,;][A-Za-z]/g;
      while ((m = nospace.exec(text))) add("spacing", "Missing space after the comma or semicolon.", around(text, m.index, m[0].length), at);
      var nospace2 = /\b[a-z]{3,}\.[A-Z][a-z]{2,}\b/g;
      while ((m = nospace2.exec(text))) add("spacing", "Missing space after the period.", around(text, m.index, m[0].length), at);
      if (spacingReliable) {
        var dbl = /\S {2,}\S/g;
        if ((m = dbl.exec(text))) add("spacing", "Extra spaces between words.", around(text, m.index, m[0].length), at);
        var before = /[A-Za-z]\s+[,;:!?]|[A-Za-z]\s+\.(?=\s|$)/g;
        while ((m = before.exec(text))) add("spacing", "Remove the space before the punctuation mark.", around(text, m.index, m[0].length), at);
      }
      // style: contractions and informal words
      var con = /\b(?:don['’]t|doesn['’]t|didn['’]t|can['’]t|won['’]t|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|shouldn['’]t|wouldn['’]t|couldn['’]t|it['’]s|that['’]s|there['’]s|we['’]re|they['’]re|you['’]re|I['’]m|I['’]ve|let['’]s)\b/i;
      if ((m = con.exec(text))) add("style", "Avoid contractions (“" + m[0] + "”) in academic writing.", around(text, m.index, m[0].length), at);
      var inf = /\b(gonna|wanna|kinda|sorta|gotta|lots of|stuff)\b/i;
      if ((m = inf.exec(text))) add("style", "Informal wording (“" + m[0] + "”) — use a more formal word.", around(text, m.index, m[0].length), at);

      // paragraph-level checks (Word only — paragraphs are real there)
      if (ch.para) {
        var open = (text.match(/\(/g) || []).length, close = (text.match(/\)/g) || []).length;
        if (open !== close) add("bracket", "Unmatched parenthesis.", clip(text, 90), at);
        if (!ch.list && wordCount(text) >= 12 && !/[.!?:;)"”'’\]]\s*$/.test(text) && text !== text.toUpperCase()) {
          add("endpunct", "This paragraph may be missing an ending period.", "…" + clip(text.slice(-70), 70), at);
        }
      }
      // sentences
      if (kind !== "pptx") {
        var sentences = text.match(/[^.!?]+(?:[.!?]+["')\]”’]*|$)/g) || [];
        var prevEnd = "";
        sentences.forEach(function (sRaw, si) {
          var sent = sRaw.trim();
          if (!sent) return;
          var words = wordCount(sent);
          if (words > 45) add("long", "Very long sentence (" + words + " words) — consider splitting it.", clip(sent, 90), at);
          if (si > 0 && /^[a-z]/.test(sent) && /[.!?]["')\]”’]*$/.test(prevEnd)) {
            var firstTok = sent.split(/\s+/)[0];
            var prevBase = prevEnd.replace(/[.!?"')\]”’]+$/, "");
            var prevLast = prevBase.split(/\s+/).pop() || "";
            if (!/^(e\.g|i\.e|et|etc|vs|www|http|https|iOS|eBay)/i.test(firstTok) && !ABBREV_BEFORE_PERIOD.test(prevLast) && /^[a-z]{2,}/.test(firstTok)) {
              add("capital", "A sentence should start with a capital letter.", clip(sent, 90), at);
            }
          }
          prevEnd = sent;
        });
      }
    });

    // shown list: keep the most useful variety, cap the total
    var shown = all.slice(0, MAX_ISSUES_SHOWN);
    return { total: total, issues: shown };
  }

  /* ---------------------------------------------------------------------- */
  /* PDF                                                                     */
  /* ---------------------------------------------------------------------- */
  async function readPdf(buffer) {
    var lib = await loadPdfjs();
    var doc = await lib.getDocument({ data: new Uint8Array(buffer.slice(0)), isEvalSupported: false, useSystemFonts: true }).promise;
    var n = Math.min(doc.numPages, MAX_PDF_PAGES);
    var pages = [], sizes = [];
    for (var p = 1; p <= n; p++) {
      var page = await doc.getPage(p);
      var vp = page.getViewport({ scale: 1 });
      sizes.push([Math.round(vp.width), Math.round(vp.height)]);
      var tc = await page.getTextContent();
      var items = tc.items.filter(function (it) { return it.str !== undefined && it.transform; }).map(function (it) {
        return { s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 0 };
      });
      items.sort(function (a, b) { return Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x; });
      var lines = [], cur = null;
      items.forEach(function (it) {
        if (!it.s.trim() && !cur) return;
        if (cur && Math.abs(cur.y - it.y) <= 3) {
          var gap = it.x - cur.endX;
          var needSpace = gap > Math.max(it.h, cur.h) * 0.2 && !/\s$/.test(cur.text) && !/^\s/.test(it.s);
          cur.text += (needSpace ? " " : "") + it.s;
          cur.endX = it.x + it.w;
          cur.h = Math.max(cur.h, it.h);
        } else {
          cur = { y: it.y, text: it.s, endX: it.x + it.w, h: it.h };
          lines.push(cur);
        }
      });
      pages.push(lines.map(function (l) { return { text: l.text.replace(/\s+/g, " ").trim(), size: l.h, page: p }; }).filter(function (l) { return l.text; }));
      page.cleanup();
    }
    var truncated = doc.numPages > n;
    var total = doc.numPages;
    try { doc.destroy(); } catch (e) { /* ignore */ }
    return { pages: pages, sizes: sizes, totalPages: total, truncated: truncated };
  }

  function analyzePdfData(d) {
    var pageWords = d.pages.map(function (ls) { return ls.reduce(function (n, l) { return n + wordCount(l.text); }, 0); });
    var words = pageWords.reduce(function (a, b) { return a + b; }, 0);
    var res = { v: 1, kind: "pdf", supported: true, pages: d.totalPages, words: words };
    if (words < 40 * Math.max(1, Math.min(3, d.pages.length)) && d.pages.length) {
      res.supported = false; res.progress = null;
      res.note = "This PDF has almost no readable text — it may be scanned or made of pictures. Export it as a text PDF from Word or PowerPoint to get a progress score and grammar check.";
      res.sections = []; res.layout = []; res.grammar = { total: 0, issues: [] };
      return res;
    }
    var allLines = [];
    d.pages.forEach(function (ls) { ls.forEach(function (l) { allLines.push(l); }); });
    var sc = scoreSections(allLines, "pdf");
    res.sections = sc.sections; res.progress = sc.progress;

    // layout
    var layout = [];
    layout.push({ status: "info", text: d.totalPages + " page" + (d.totalPages === 1 ? "" : "s") + (d.truncated ? " (only the first " + MAX_PDF_PAGES + " were checked)" : "") + "." });
    var blank = [];
    pageWords.forEach(function (n, i) { if (n < 5) blank.push(i + 1); });
    layout.push(blank.length
      ? { status: "warn", text: "Nearly empty page" + (blank.length > 1 ? "s" : "") + ": " + listNumbers(blank) + ". Remove blank pages unless a section break needs them." }
      : { status: "pass", text: "No blank pages." });
    var uniqSizes = {};
    d.sizes.forEach(function (s) { uniqSizes[Math.round(s[0] / 4) + "x" + Math.round(s[1] / 4)] = true; });
    layout.push(Object.keys(uniqSizes).length > 1
      ? { status: "warn", text: "Pages are not all the same size — check that the whole paper uses one paper size." }
      : { status: "pass", text: "All pages are the same size." });
    var sizes = allLines.map(function (l) { return l.size; }).filter(function (s) { return s > 0; });
    var med = median(sizes);
    if (med) {
      var medR = Math.round(med * 2) / 2;
      layout.push(med < 10 ? { status: "warn", text: "Body text looks small (about " + medR + " pt). Most papers use 11–12 pt." }
        : med > 14 ? { status: "warn", text: "Body text looks large (about " + medR + " pt). Most papers use 11–12 pt." }
        : { status: "pass", text: "Body text is about " + medR + " pt." });
      var heads = allLines.filter(function (l) { return l.size >= med * 1.2 && wordCount(l.text) <= 12; }).length;
      var headsByName = scoreSections(allLines, "pdf").sections.filter(function (s) { return s.state !== "missing"; }).length;
      layout.push(heads + headsByName > 0
        ? { status: "pass", text: "Section headings are visible." }
        : { status: "warn", text: "No clear headings were found. Use larger or bold headings for each chapter." });
    }
    var numbered = 0;
    d.pages.forEach(function (ls) {
      if (!ls.length) return;
      var firstL = ls[0].text, lastL = ls[ls.length - 1].text;
      if (/^(page\s*)?\d{1,3}$/i.test(lastL) || /^(page\s*)?\d{1,3}$/i.test(firstL)) numbered++;
    });
    layout.push(numbered >= d.pages.length * 0.5
      ? { status: "pass", text: "Page numbers found." }
      : { status: "warn", text: "Page numbers were not found on most pages." });
    res.layout = layout;

    // grammar — skip the references list and table-of-contents lines
    var refStart = -1;
    allLines.forEach(function (l, i) { if (refStart < 0 && /^(references|bibliography|works cited)$/i.test(l.text.replace(/[^A-Za-z ]/g, "").trim())) refStart = i; });
    var chunks = [];
    d.pages.forEach(function (ls, pi) {
      var pageText = ls.filter(function (l) { return !isTocLike(l.text) && wordCount(l.text) >= 1; }).map(function (l) { return l.text; });
      if (refStart >= 0) {
        var offset = 0; for (var k = 0; k < pi; k++) offset += d.pages[k].length;
        pageText = ls.filter(function (l, li) { return offset + li < refStart; }).map(function (l) { return l.text; });
      }
      if (pageText.length) chunks.push({ text: pageText.join(" "), at: "page " + (pi + 1) });
    });
    res.grammar = checkGrammar(chunks, "pdf");
    return res;
  }

  /* ---------------------------------------------------------------------- */
  /* Word (.docx)                                                            */
  /* ---------------------------------------------------------------------- */
  function parseXml(str) {
    var doc = new DOMParser().parseFromString(str, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("Couldn't read this document.");
    return doc;
  }
  function attr(el, name) { return el ? (el.getAttribute(name) || el.getAttribute("w:" + name)) : null; }
  function firstChild(el, tag) {
    if (!el) return null;
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) { if (c.tagName === tag) return c; }
    return null;
  }

  async function readDocx(buffer) {
    var JSZip = await loadJSZip();
    var zip = await JSZip.loadAsync(buffer);
    var docFile = zip.file("word/document.xml");
    if (!docFile) throw new Error("Couldn't read this document.");
    var docXml = parseXml(await docFile.async("string"));
    var stylesFile = zip.file("word/styles.xml");
    var stylesXml = stylesFile ? parseXml(await stylesFile.async("string")) : null;

    // styles: default font/size, and per-style font/size/heading flag
    var defaults = { sz: null, font: null }, styleMap = {};
    if (stylesXml) {
      var dd = stylesXml.getElementsByTagName("w:docDefaults")[0];
      if (dd) {
        var drp = dd.getElementsByTagName("w:rPr")[0];
        if (drp) {
          var dsz = firstChild(drp, "w:sz"); if (dsz) defaults.sz = Number(attr(dsz, "w:val")) / 2;
          var dfont = firstChild(drp, "w:rFonts"); if (dfont) defaults.font = attr(dfont, "w:ascii") || attr(dfont, "w:hAnsi");
        }
      }
      Array.prototype.forEach.call(stylesXml.getElementsByTagName("w:style"), function (st) {
        var id = attr(st, "w:styleId");
        var nameEl = firstChild(st, "w:name");
        var name = nameEl ? (attr(nameEl, "w:val") || "") : "";
        var rpr = firstChild(st, "w:rPr");
        var ppr = firstChild(st, "w:pPr");
        var o = { name: name, heading: /^(heading\s*\d|title|subtitle)/i.test(name) || /^(Heading\d|Title)/i.test(id || "") };
        if (rpr) {
          var sz = firstChild(rpr, "w:sz"); if (sz) o.sz = Number(attr(sz, "w:val")) / 2;
          var rf = firstChild(rpr, "w:rFonts"); if (rf) o.font = attr(rf, "w:ascii") || attr(rf, "w:hAnsi");
        }
        if (ppr) {
          var sp = firstChild(ppr, "w:spacing"); if (sp && attr(sp, "w:line")) o.line = Number(attr(sp, "w:line"));
        }
        styleMap[id] = o;
      });
    }
    var normal = styleMap["Normal"] || {};
    var baseSz = normal.sz || defaults.sz || 11;
    var baseFont = normal.font || defaults.font || "Default";

    // pages (docProps/app.xml)
    var pages = null;
    var appFile = zip.file("docProps/app.xml");
    if (appFile) {
      var m = /<Pages>(\d+)<\/Pages>/.exec(await appFile.async("string"));
      if (m) pages = Number(m[1]);
    }

    // header/footer page numbers
    var hasPageNumber = false;
    var hf = zip.file(/^word\/(footer|header)\d*\.xml$/);
    for (var i = 0; i < hf.length; i++) {
      var t = await hf[i].async("string");
      if (/instrText[^>]*>[^<]*\bPAGE\b/.test(t) || /w:fldSimple[^>]*w:instr="[^"]*\bPAGE\b/.test(t)) { hasPageNumber = true; break; }
    }

    // paragraphs
    var body = docXml.getElementsByTagName("w:body")[0];
    var paras = [];
    var allP = docXml.getElementsByTagName("w:p");
    for (var pi = 0; pi < allP.length; pi++) {
      var p = allP[pi];
      var ppr = firstChild(p, "w:pPr");
      var styleId = ppr ? attr(firstChild(ppr, "w:pStyle"), "w:val") : null;
      var style = (styleId && styleMap[styleId]) || {};
      var isList = !!(ppr && firstChild(ppr, "w:numPr"));
      var lineSp = null;
      if (ppr) { var sp = firstChild(ppr, "w:spacing"); if (sp && attr(sp, "w:line")) lineSp = Number(attr(sp, "w:line")); }
      if (lineSp === null && style.line) lineSp = style.line;
      var text = "", runInfo = [];
      var runs = p.getElementsByTagName("w:r");
      for (var ri = 0; ri < runs.length; ri++) {
        var r = runs[ri];
        var rt = "";
        for (var c = r.firstElementChild; c; c = c.nextElementSibling) {
          if (c.tagName === "w:t") rt += c.textContent;
          else if (c.tagName === "w:tab") rt += " ";
          else if (c.tagName === "w:br") rt += " ";
        }
        if (!rt) continue;
        text += rt;
        var rpr = firstChild(r, "w:rPr");
        var rsz = rpr ? firstChild(rpr, "w:sz") : null;
        var rfont = rpr ? firstChild(rpr, "w:rFonts") : null;
        runInfo.push({
          len: rt.length,
          sz: rsz ? Number(attr(rsz, "w:val")) / 2 : (style.sz || baseSz),
          font: (rfont && (attr(rfont, "w:ascii") || attr(rfont, "w:hAnsi"))) || style.font || baseFont
        });
      }
      paras.push({ text: text.replace(/\s+$/g, ""), heading: !!style.heading, list: isList, runs: runInfo, line: lineSp });
    }

    // margins (first section)
    var margins = null;
    var pgMar = docXml.getElementsByTagName("w:pgMar")[0];
    if (pgMar) {
      margins = {};
      ["top", "bottom", "left", "right"].forEach(function (k) { var v = attr(pgMar, "w:" + k); if (v) margins[k] = Number(v) / 1440; });
    }
    var hasToc = /instrText[^>]*>[^<]*\bTOC\b/.test(await docFile.async("string"));
    return { paras: paras, margins: margins, pages: pages, hasPageNumber: hasPageNumber, hasToc: hasToc, baseSz: baseSz, baseFont: baseFont };
  }

  function analyzeDocxData(d) {
    var textParas = d.paras.filter(function (p) { return p.text.trim(); });
    var words = textParas.reduce(function (n, p) { return n + wordCount(p.text); }, 0);
    var res = { v: 1, kind: "docx", supported: true, pages: d.pages, words: words };
    var lines = textParas.map(function (p) { return { text: p.text.trim() }; });
    var sc = scoreSections(lines, "docx");
    res.sections = sc.sections; res.progress = sc.progress;

    var layout = [];
    // fonts, weighted by amount of text
    var fontChars = {}, sizeChars = {}, totalChars = 0;
    textParas.forEach(function (p) {
      p.runs.forEach(function (r) {
        if (p.heading) return;
        fontChars[r.font] = (fontChars[r.font] || 0) + r.len;
        sizeChars[r.sz] = (sizeChars[r.sz] || 0) + r.len;
        totalChars += r.len;
      });
    });
    var fonts = Object.keys(fontChars).filter(function (f) { return fontChars[f] / Math.max(1, totalChars) >= 0.05; });
    layout.push(fonts.length > 2
      ? { status: "warn", text: "Uses " + fonts.length + " different fonts in the body (" + fonts.slice(0, 4).join(", ") + "). Use one font for the body text." }
      : { status: "pass", text: "Consistent fonts" + (fonts.length ? " (" + fonts.join(", ") + ")." : ".") });
    var sizeKeys = Object.keys(sizeChars).sort(function (a, b) { return sizeChars[b] - sizeChars[a]; });
    if (sizeKeys.length) {
      var dom = Number(sizeKeys[0]);
      var share = sizeChars[sizeKeys[0]] / Math.max(1, totalChars);
      if (dom < 10) layout.push({ status: "warn", text: "Body text is " + dom + " pt — that is small. Most papers use 11–12 pt." });
      else if (dom > 14) layout.push({ status: "warn", text: "Body text is " + dom + " pt — that is large. Most papers use 11–12 pt." });
      else layout.push({ status: share >= 0.6 ? "pass" : "warn", text: share >= 0.6 ? "Body text is " + dom + " pt." : "Text sizes vary a lot (" + sizeKeys.slice(0, 4).join(", ") + " pt). Use one size for the body text." });
    }
    var headings = d.paras.filter(function (p) { return p.heading && p.text.trim(); }).length;
    layout.push(headings
      ? { status: "pass", text: headings + " heading" + (headings === 1 ? "" : "s") + " use Word’s Heading styles." }
      : { status: "warn", text: "No Heading styles were used. Apply Heading 1 / Heading 2 to chapter titles so Word can build a table of contents." });
    // blank paragraph runs
    var spots = 0, run = 0;
    d.paras.forEach(function (p) {
      if (!p.text.trim()) { run++; if (run === 3) spots++; } else run = 0;
    });
    layout.push(spots
      ? { status: "warn", text: "Several blank lines in a row in " + spots + " place" + (spots === 1 ? "" : "s") + ". Use paragraph spacing or a page break instead of pressing Enter." }
      : { status: "pass", text: "No stretches of blank lines." });
    if (d.margins) {
      var small = Object.keys(d.margins).filter(function (k) { return d.margins[k] < 0.75; });
      layout.push(small.length
        ? { status: "warn", text: "Margin" + (small.length > 1 ? "s" : "") + " (" + small.join(", ") + ") smaller than 0.75 in." }
        : { status: "pass", text: "Margins are " + ["top", "left", "bottom", "right"].map(function (k) { return d.margins[k] !== undefined ? d.margins[k].toFixed(2) : "?"; }).join(" / ") + " in (top / left / bottom / right)." });
    }
    layout.push(d.hasPageNumber ? { status: "pass", text: "Page numbers found." } : { status: "warn", text: "No page numbers found in the header or footer." });
    layout.push(d.hasToc ? { status: "pass", text: "Table of contents found." } : { status: "info", text: "No automatic table of contents found." });
    res.layout = layout;

    // grammar: everything before the reference list, skipping short headings
    var refAt = -1;
    textParas.forEach(function (p, i) { if (refAt < 0 && /^(references|bibliography|works cited)$/i.test(p.text.replace(/[^A-Za-z ]/g, "").trim())) refAt = i; });
    var chunks = [];
    textParas.forEach(function (p, i) {
      if (refAt >= 0 && i >= refAt) return;
      if (p.heading || isTocLike(p.text) || wordCount(p.text) < 4) return;
      chunks.push({ text: p.text, at: "paragraph " + (d.paras.indexOf(p) + 1), para: true, list: p.list });
    });
    res.grammar = checkGrammar(chunks, "docx");
    return res;
  }

  /* ---------------------------------------------------------------------- */
  /* PowerPoint (.pptx)                                                      */
  /* ---------------------------------------------------------------------- */
  async function readPptx(buffer) {
    var JSZip = await loadJSZip();
    var zip = await JSZip.loadAsync(buffer);
    var slideFiles = zip.file(/^ppt\/slides\/slide\d+\.xml$/).sort(function (a, b) {
      return Number(a.name.match(/(\d+)\.xml$/)[1]) - Number(b.name.match(/(\d+)\.xml$/)[1]);
    });
    var slides = [];
    for (var i = 0; i < slideFiles.length; i++) {
      var xml = parseXml(await slideFiles[i].async("string"));
      var title = "", paragraphs = [], sizes = [], fonts = {};
      var shapes = xml.getElementsByTagName("p:sp");
      for (var s = 0; s < shapes.length; s++) {
        var sp = shapes[s];
        var ph = sp.getElementsByTagName("p:ph")[0];
        var phType = ph ? ph.getAttribute("type") : null;
        var isTitle = phType === "title" || phType === "ctrTitle";
        var paraEls = sp.getElementsByTagName("a:p");
        var shapeText = [];
        for (var pi = 0; pi < paraEls.length; pi++) {
          var pt = "";
          var ts = paraEls[pi].getElementsByTagName("a:t");
          for (var t = 0; t < ts.length; t++) pt += ts[t].textContent;
          pt = pt.trim();
          if (!pt) continue;
          shapeText.push(pt);
          var rp = paraEls[pi].getElementsByTagName("a:rPr");
          for (var q = 0; q < rp.length; q++) {
            var sz = rp[q].getAttribute("sz"); if (sz) sizes.push(Number(sz) / 100);
            var lat = rp[q].getElementsByTagName("a:latin")[0];
            if (lat && lat.getAttribute("typeface") && !/^\+/.test(lat.getAttribute("typeface"))) fonts[lat.getAttribute("typeface")] = true;
          }
        }
        if (isTitle) title = shapeText.join(" ");
        else shapeText.forEach(function (x) { paragraphs.push(x); });
      }
      // table cells and anything not in a shape with text
      var tbl = xml.getElementsByTagName("a:tbl")[0];
      if (tbl) {
        var cells = tbl.getElementsByTagName("a:t");
        var ct = ""; for (var c = 0; c < cells.length; c++) ct += cells[c].textContent + " ";
        if (ct.trim()) paragraphs.push(ct.trim());
      }
      slides.push({ title: title, paragraphs: paragraphs, sizes: sizes, fonts: Object.keys(fonts), pics: xml.getElementsByTagName("p:pic").length });
    }
    return { slides: slides };
  }

  function analyzePptxData(d) {
    var res = { v: 1, kind: "pptx", supported: true, slides: d.slides.length };
    var words = 0;
    d.slides.forEach(function (s) { words += wordCount(s.title) + s.paragraphs.reduce(function (n, p) { return n + wordCount(p); }, 0); });
    res.words = words;
    if (!d.slides.length || words < 8) {
      res.supported = false; res.progress = null;
      res.note = "This presentation has almost no readable text, so a progress score and grammar check can't be made.";
      res.sections = []; res.layout = []; res.grammar = { total: 0, issues: [] };
      return res;
    }
    var lines = [];
    d.slides.forEach(function (s, i) {
      if (s.title) lines.push({ text: s.title, slide: i + 1 });
      s.paragraphs.forEach(function (p) { lines.push({ text: p, slide: i + 1, body: true }); });
    });
    // for slide decks only slide titles count as headings
    var titleLines = lines.map(function (l) { return l.body ? { text: l.text } : { text: l.text }; });
    var sc = scoreSections(titleLines.map(function (l, i) { return lines[i].body ? { text: "" + l.text } : l; }), "pptx");
    // body lines must not be treated as headings: recompute using only titles as candidates
    sc = scoreSlideTitles(d.slides);
    res.sections = sc.sections; res.progress = sc.progress;

    var layout = [];
    layout.push({ status: "info", text: d.slides.length + " slide" + (d.slides.length === 1 ? "" : "s") + "." });
    var noTitle = [], empty = [], heavy = [], small = [], bullets = [];
    d.slides.forEach(function (s, i) {
      var n = i + 1, w = wordCount(s.title) + s.paragraphs.reduce(function (a, p) { return a + wordCount(p); }, 0);
      if (!s.title.trim()) noTitle.push(n);
      if (w === 0 && !s.pics) empty.push(n);
      if (w > 90) heavy.push(n);
      if (s.sizes.some(function (z) { return z < 14; }) && w > 0) small.push(n);
      if (s.paragraphs.length > 7) bullets.push(n);
    });
    layout.push(noTitle.length
      ? { status: "warn", text: "Slide" + (noTitle.length > 1 ? "s" : "") + " without a title: " + listNumbers(noTitle) + "." }
      : { status: "pass", text: "Every slide has a title." });
    layout.push(empty.length ? { status: "warn", text: "Empty slide" + (empty.length > 1 ? "s" : "") + ": " + listNumbers(empty) + "." } : { status: "pass", text: "No empty slides." });
    layout.push(heavy.length
      ? { status: "warn", text: "Too much text (over 90 words) on slide" + (heavy.length > 1 ? "s" : "") + " " + listNumbers(heavy) + ". Keep slides short." }
      : { status: "pass", text: "Slides are not overcrowded." });
    layout.push(bullets.length ? { status: "warn", text: "More than 7 bullet points on slide" + (bullets.length > 1 ? "s" : "") + " " + listNumbers(bullets) + "." } : { status: "pass", text: "Bullet counts are reasonable." });
    layout.push(small.length
      ? { status: "warn", text: "Text smaller than 14 pt on slide" + (small.length > 1 ? "s" : "") + " " + listNumbers(small) + " is hard to read when presenting." }
      : { status: "pass", text: "Text sizes are readable." });
    var fontSet = {};
    d.slides.forEach(function (s) { s.fonts.forEach(function (f) { fontSet[f] = true; }); });
    var fontList = Object.keys(fontSet);
    layout.push(fontList.length > 2
      ? { status: "warn", text: "Uses " + fontList.length + " different fonts (" + fontList.slice(0, 4).join(", ") + "). Stick to one or two." }
      : { status: "pass", text: "Consistent fonts." });
    res.layout = layout;

    var chunks = [];
    d.slides.forEach(function (s, i) {
      var items = s.paragraphs.filter(function (p) { return wordCount(p) >= 3; });
      items.forEach(function (p) { chunks.push({ text: p, at: "slide " + (i + 1) }); });
    });
    res.grammar = checkGrammar(chunks, "pptx");
    return res;
  }

  function scoreSlideTitles(slides) {
    var sections = [], total = 0, count = 0;
    SECTIONS.forEach(function (s) {
      if (s.only && s.only.indexOf("pptx") === -1) return;
      var need = s.minWordsSlide || MIN_WORDS_SLIDE, best = -1;
      slides.forEach(function (sl, i) {
        if (!sl.title || !s.re.test(sl.title.toLowerCase())) return;
        // content = this slide's body plus following slides until the next section title
        var words = sl.paragraphs.reduce(function (n, p) { return n + wordCount(p); }, 0);
        for (var j = i + 1; j < slides.length; j++) {
          if (slides[j].title && matchedSection(slides[j].title, "pptx")) break;
          words += slides[j].paragraphs.reduce(function (n, p) { return n + wordCount(p); }, 0);
        }
        if (words > best) best = words;
      });
      var state = best < 0 ? "missing" : best >= need ? "found" : "thin";
      sections.push({ id: s.id, label: s.label, state: state });
      total += state === "found" ? 1 : state === "thin" ? 0.5 : 0;
      count++;
    });
    return { sections: sections, progress: count ? Math.round(total / count * 100) : 0 };
  }

  /* ---------------------------------------------------------------------- */
  /* public: analyze                                                         */
  /* ---------------------------------------------------------------------- */
  function unsupported(kind, note) {
    return { v: 1, kind: kind, supported: false, progress: null, note: note, sections: [], layout: [], grammar: { total: 0, issues: [] } };
  }

  /** info: the object returned by inspect(). Never rejects — a failed check
   *  resolves to an "unsupported" result so the upload itself can still go ahead. */
  async function analyze(info) {
    try {
      if (info.ext === "doc" || info.ext === "ppt") {
        return unsupported(info.kind, "Automatic checks work with " + (info.ext === "doc" ? ".docx" : ".pptx") +
          " files. This older ." + info.ext + " format can’t be read — save it as ." + info.ext + "x and upload that to get a progress score and grammar/layout review.");
      }
      var work = info.kind === "pdf" ? readPdf(info.buffer).then(analyzePdfData)
        : info.kind === "docx" ? readDocx(info.buffer).then(analyzeDocxData)
        : readPptx(info.buffer).then(analyzePptxData);
      return await withTimeout(work, ANALYSIS_TIMEOUT_MS);
    } catch (e) {
      return unsupported(info.kind, e && e.message === "timeout"
        ? "This file took too long to check, so no progress score was made."
        : "The automatic check couldn’t read this file" + (e && e.message ? " (" + e.message + ")" : "") + ", so no progress score was made.");
    }
  }

  global.Analyzer = {
    IMAGE_EXTS: IMAGE_EXTS,
    SECTIONS: SECTIONS,
    kindFromExt: kindFromExt,
    inspect: inspect,
    analyze: analyze,
    // exposed for tests
    _sniff: sniff,
    _checkGrammar: checkGrammar,
    _scoreSections: scoreSections
  };
})(window);
