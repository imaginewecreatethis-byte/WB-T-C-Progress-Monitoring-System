/* ============================================================================
   viewer.js — WB-T&C Progress Monitoring System
   Shows the ACTUAL file inside the page (no download needed):
     • images  – shown as they are
     • PDF     – every page drawn from the file itself (pdf.js)
     • Word    – .docx text, headings, lists, tables and pictures
     • PowerPoint – .pptx slides with their shapes, text and pictures
   Everything is drawn in the browser from the stored file; the file is not sent
   to any outside service. Old .doc / .ppt files can't be shown (download them).
   Charts, animations, SmartArt and some special fonts are not drawn exactly.
   Student text is only ever added to the page as plain text (never as HTML).
   ============================================================================ */
(function (global) {
  "use strict";

  var MAX_PDF_PAGES = 150;
  var EMU_PX = 9525;           // 1 px = 9525 EMU
  var SAFE_IMG = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };

  /* ------------------------------------------------------------------ */
  /* tiny helpers                                                         */
  /* ------------------------------------------------------------------ */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function extOf(name) { return (String(name || "").split(".").pop() || "").toLowerCase(); }
  function parseXml(str) {
    var d = new DOMParser().parseFromString(str, "application/xml");
    if (d.getElementsByTagName("parsererror").length) throw new Error("Couldn't read this file.");
    return d;
  }
  function kids(node, tag) {
    var out = [];
    if (!node) return out;
    for (var c = node.firstElementChild; c; c = c.nextElementSibling) { if (!tag || c.tagName === tag) out.push(c); }
    return out;
  }
  function kid(node, tag) { return kids(node, tag)[0] || null; }
  function at(node, name) { return node ? node.getAttribute(name) : null; }
  function num(v, d) { var n = Number(v); return isFinite(n) && v !== null && v !== "" ? n : d; }
  function cssFont(name) {
    name = String(name || "").replace(/[^\w \-]/g, "").trim();
    return name ? '"' + name + '", Calibri, Arial, sans-serif' : "";
  }
  function cssColor(hex) { return /^[0-9a-fA-F]{6}$/.test(hex || "") ? "#" + hex : ""; }
  function normPath(base, target) {
    // base: folder of the owning part, e.g. "ppt/slides"; target may start with ../
    if (/^\//.test(target)) return target.slice(1);
    var parts = base.split("/").filter(Boolean);
    target.split("/").forEach(function (p) {
      if (p === "..") parts.pop(); else if (p && p !== ".") parts.push(p);
    });
    return parts.join("/");
  }
  async function readRels(zip, path) {
    var f = zip.file(path), map = {};
    if (!f) return map;
    var x = parseXml(await f.async("string"));
    Array.prototype.forEach.call(x.getElementsByTagName("Relationship"), function (r) {
      map[r.getAttribute("Id")] = { target: r.getAttribute("Target"), mode: r.getAttribute("TargetMode"), type: r.getAttribute("Type") };
    });
    return map;
  }
  /** blob: URL for a picture inside the file, or null when it isn't a safe picture type. */
  var blobUrls = [];
  async function imageUrl(zip, path) {
    var ext = extOf(path);
    if (!SAFE_IMG[ext]) return null;
    var f = zip.file(path);
    if (!f) return null;
    var data = await f.async("uint8array");
    var url = URL.createObjectURL(new Blob([data], { type: SAFE_IMG[ext] }));
    blobUrls.push(url);
    return url;
  }

  /* ------------------------------------------------------------------ */
  /* PDF                                                                  */
  /* ------------------------------------------------------------------ */
  async function renderPdf(buffer, host, status) {
    var lib = await global.Analyzer.loadPdfjs();
    var doc = await lib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true }).promise;
    var n = Math.min(doc.numPages, MAX_PDF_PAGES);
    var width = Math.max(280, Math.min(host.clientWidth - 24, 900));
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var slots = [];
    for (var p = 1; p <= n; p++) {
      var wrap = el("div", "vw-pdfpage");
      var page = await doc.getPage(p);
      var base = page.getViewport({ scale: 1 });
      var scale = width / base.width;
      var vp = page.getViewport({ scale: scale });
      wrap.style.width = Math.floor(vp.width) + "px";
      wrap.style.height = Math.floor(vp.height) + "px";
      host.appendChild(wrap);
      slots.push({ wrap: wrap, page: page, vp: vp, done: false });
    }
    status("");
    async function draw(slot) {
      if (slot.done) return;
      slot.done = true;
      var canvas = document.createElement("canvas");
      canvas.width = Math.floor(slot.vp.width * dpr);
      canvas.height = Math.floor(slot.vp.height * dpr);
      canvas.style.width = "100%"; canvas.style.height = "100%";
      slot.wrap.appendChild(canvas);
      await slot.page.render({ canvasContext: canvas.getContext("2d"), viewport: slot.vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
    }
    if ("IntersectionObserver" in global) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { var s = slots.filter(function (x) { return x.wrap === en.target; })[0]; if (s) draw(s); io.unobserve(en.target); }
        });
      }, { root: null, rootMargin: "600px 0px" });
      slots.forEach(function (s) { io.observe(s.wrap); });
    } else {
      for (var i = 0; i < slots.length; i++) await draw(slots[i]);
    }
    if (doc.numPages > n) host.appendChild(el("div", "vw-note", "Showing the first " + n + " of " + doc.numPages + " pages. Download the file to read the rest."));
  }

  /* ------------------------------------------------------------------ */
  /* Word (.docx)                                                         */
  /* ------------------------------------------------------------------ */
  function onOff(node) {
    if (!node) return false;
    var v = at(node, "w:val");
    return !(v === "0" || v === "false" || v === "off");
  }
  function runProps(rpr, out) {
    if (!rpr) return out;
    if (kid(rpr, "w:b")) out.b = onOff(kid(rpr, "w:b"));
    if (kid(rpr, "w:i")) out.i = onOff(kid(rpr, "w:i"));
    var u = kid(rpr, "w:u"); if (u) out.u = at(u, "w:val") !== "none";
    if (kid(rpr, "w:strike")) out.s = onOff(kid(rpr, "w:strike"));
    var sz = kid(rpr, "w:sz"); if (sz) out.sz = num(at(sz, "w:val"), 0) / 2;
    var col = kid(rpr, "w:color"); if (col && at(col, "w:val") !== "auto") out.color = cssColor(at(col, "w:val"));
    var rf = kid(rpr, "w:rFonts"); if (rf) out.font = at(rf, "w:ascii") || at(rf, "w:hAnsi") || out.font;
    var va = kid(rpr, "w:vertAlign"); if (va) out.va = at(va, "w:val");
    var hl = kid(rpr, "w:shd"); if (hl && at(hl, "w:fill") && at(hl, "w:fill") !== "auto") out.bg = cssColor(at(hl, "w:fill"));
    return out;
  }
  function applyRun(span, p) {
    var st = span.style;
    if (p.b) st.fontWeight = "700";
    if (p.i) st.fontStyle = "italic";
    var deco = [];
    if (p.u) deco.push("underline");
    if (p.s) deco.push("line-through");
    if (deco.length) st.textDecoration = deco.join(" ");
    if (p.sz) st.fontSize = p.sz + "pt";
    if (p.color) st.color = p.color;
    if (p.bg) st.backgroundColor = p.bg;
    if (p.font) st.fontFamily = cssFont(p.font);
    if (p.va === "superscript") { st.verticalAlign = "super"; st.fontSize = "0.75em"; }
    if (p.va === "subscript") { st.verticalAlign = "sub"; st.fontSize = "0.75em"; }
  }

  async function renderDocx(buffer, host) {
    var JSZip = await global.Analyzer.loadJSZip();
    var zip = await JSZip.loadAsync(buffer);
    var docFile = zip.file("word/document.xml");
    if (!docFile) throw new Error("Couldn't read this document.");
    var doc = parseXml(await docFile.async("string"));
    var rels = await readRels(zip, "word/_rels/document.xml.rels");

    // styles
    var styles = {}, def = {};
    var sf = zip.file("word/styles.xml");
    if (sf) {
      var sx = parseXml(await sf.async("string"));
      var dd = sx.getElementsByTagName("w:docDefaults")[0];
      if (dd) runProps(kid(kid(dd, "w:rPrDefault"), "w:rPr"), def);
      Array.prototype.forEach.call(sx.getElementsByTagName("w:style"), function (st) {
        var id = at(st, "w:styleId"), nm = kid(st, "w:name"), bo = kid(st, "w:basedOn");
        var o = { name: at(nm, "w:val") || "", based: at(bo, "w:val"), r: {}, jc: null, ind: null };
        runProps(kid(st, "w:rPr"), o.r);
        var ppr = kid(st, "w:pPr");
        if (ppr) {
          var jc = kid(ppr, "w:jc"); if (jc) o.jc = at(jc, "w:val");
          var ind = kid(ppr, "w:ind"); if (ind) o.ind = num(at(ind, "w:left") || at(ind, "w:start"), null);
          var snp = kid(ppr, "w:numPr");
          if (snp) { o.numId = at(kid(snp, "w:numId"), "w:val"); o.ilvl = at(kid(snp, "w:ilvl"), "w:val"); }
        }
        styles[id] = o;
      });
    }
    function styleChain(id) {
      var chain = [], seen = 0;
      while (id && styles[id] && seen++ < 8) { chain.unshift(styles[id]); id = styles[id].based; }
      return chain;
    }

    // numbering: numId -> level -> {fmt}
    var numbering = {};
    var nf = zip.file("word/numbering.xml");
    if (nf) {
      var nx = parseXml(await nf.async("string"));
      var abs = {};
      Array.prototype.forEach.call(nx.getElementsByTagName("w:abstractNum"), function (a) {
        var lv = {};
        kids(a, "w:lvl").forEach(function (l) {
          lv[at(l, "w:ilvl")] = { fmt: at(kid(l, "w:numFmt"), "w:val") || "decimal", text: at(kid(l, "w:lvlText"), "w:val") || "" };
        });
        abs[at(a, "w:abstractNumId")] = lv;
      });
      Array.prototype.forEach.call(nx.getElementsByTagName("w:num"), function (n) {
        var a = kid(n, "w:abstractNumId");
        numbering[at(n, "w:numId")] = abs[at(a, "w:val")] || {};
      });
    }
    var counters = {};

    var page = el("div", "vw-docpage");
    if (def.font) page.style.fontFamily = cssFont(def.font);
    if (def.sz) page.style.fontSize = def.sz + "pt";
    host.appendChild(page);

    async function pictureFor(node) {
      var blip = node.getElementsByTagName("a:blip")[0];
      var rid = blip ? (blip.getAttribute("r:embed")) : null;
      if (!rid) { var im = node.getElementsByTagName("v:imagedata")[0]; rid = im ? im.getAttribute("r:id") : null; }
      if (!rid || !rels[rid]) return null;
      var url = await imageUrl(zip, normPath("word", rels[rid].target));
      if (!url) return null;
      var img = document.createElement("img");
      img.src = url; img.alt = "";
      var ext = node.getElementsByTagName("wp:extent")[0];
      if (ext) { img.style.width = Math.round(num(at(ext, "cx"), 0) / EMU_PX) + "px"; }
      img.style.maxWidth = "100%";
      return img;
    }

    async function addRunsInto(parent, container, pstyle) {
      for (var c = container.firstElementChild; c; c = c.nextElementSibling) {
        var tag = c.tagName;
        if (tag === "w:r") {
          var props = {};
          Object.keys(pstyle).forEach(function (k) { props[k] = pstyle[k]; });
          var rst = kid(kid(c, "w:rPr"), "w:rStyle");
          if (rst && styles[at(rst, "w:val")]) styleChain(at(rst, "w:val")).forEach(function (s) { Object.keys(s.r).forEach(function (k) { props[k] = s.r[k]; }); });
          runProps(kid(c, "w:rPr"), props);
          for (var k2 = c.firstElementChild; k2; k2 = k2.nextElementSibling) {
            var t = k2.tagName, span;
            if (t === "w:t") { span = el("span", "", k2.textContent); applyRun(span, props); parent.appendChild(span); }
            else if (t === "w:tab") { span = el("span", "vw-tab", "    "); parent.appendChild(span); }
            else if (t === "w:br") {
              if (at(k2, "w:type") === "page") parent.appendChild(el("span", "vw-pagebreak"));
              else parent.appendChild(document.createElement("br"));
            } else if (t === "w:drawing" || t === "w:pict") {
              var im = await pictureFor(k2); if (im) parent.appendChild(im);
            }
          }
        } else if (tag === "w:hyperlink" || tag === "w:ins" || tag === "w:smartTag" || tag === "w:sdt" || tag === "w:sdtContent" || tag === "w:fldSimple") {
          await addRunsInto(parent, c, pstyle);
        }
      }
    }

    async function renderPara(p, into) {
      var ppr = kid(p, "w:pPr");
      var sid = ppr ? at(kid(ppr, "w:pStyle"), "w:val") : null;
      var chain = styleChain(sid);
      var name = chain.length ? chain[chain.length - 1].name : "";
      var hm = /^heading\s*(\d)/i.exec(name) || (/^title$/i.test(name) ? [0, "1"] : null);
      var block = el(hm ? "h" + Math.min(6, Number(hm[1])) : "p", hm ? "vw-h" : "vw-p");
      var pstyle = {};
      chain.forEach(function (s) { Object.keys(s.r).forEach(function (k) { pstyle[k] = s.r[k]; }); });
      var jc = null, ind = null;
      chain.forEach(function (s) { if (s.jc) jc = s.jc; if (s.ind !== null && s.ind !== undefined) ind = s.ind; });
      if (ppr) {
        var j2 = kid(ppr, "w:jc"); if (j2) jc = at(j2, "w:val");
        var i2 = kid(ppr, "w:ind"); if (i2) ind = num(at(i2, "w:left") || at(i2, "w:start"), ind);
        var rp = kid(ppr, "w:rPr"); if (rp) runProps(rp, pstyle);
      }
      if (jc) block.style.textAlign = jc === "both" ? "justify" : jc === "center" ? "center" : (jc === "right" || jc === "end") ? "right" : "left";
      if (ind) block.style.marginLeft = Math.round(ind / 20) + "pt";
      // lists
      var numPr = ppr ? kid(ppr, "w:numPr") : null;
      var nid = numPr ? at(kid(numPr, "w:numId"), "w:val") : null, lvl = numPr ? Number(at(kid(numPr, "w:ilvl"), "w:val") || 0) : 0;
      if (!numPr) chain.forEach(function (s) { if (s.numId) { nid = s.numId; lvl = Number(s.ilvl || 0); } });   // list set by the paragraph style
      if (nid && nid !== "0") {
        var def2 = (numbering[nid] || {})[String(lvl)] || { fmt: "bullet", text: "" };
        var marker;
        if (def2.fmt === "bullet") marker = "•";
        else {
          var key = nid;
          counters[key] = counters[key] || [];
          counters[key][lvl] = (counters[key][lvl] || 0) + 1;
          counters[key].length = lvl + 1;
          var v = counters[key][lvl];
          marker = (def2.fmt === "lowerLetter" ? String.fromCharCode(96 + ((v - 1) % 26) + 1) : def2.fmt === "upperLetter" ? String.fromCharCode(64 + ((v - 1) % 26) + 1) :
                    def2.fmt === "lowerRoman" ? roman(v).toLowerCase() : def2.fmt === "upperRoman" ? roman(v) : String(v)) + ".";
        }
        block.classList.add("vw-li");
        block.style.marginLeft = (ind ? Math.round(ind / 20) : 18 + lvl * 18) + "pt";
        block.appendChild(el("span", "vw-marker", marker + " "));
      }
      await addRunsInto(block, p, pstyle);
      if (!block.textContent.trim() && !block.querySelector("img")) block.classList.add("vw-empty");
      into.appendChild(block);
    }
    function roman(n) {
      var map = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]], s = "";
      map.forEach(function (m) { while (n >= m[0]) { s += m[1]; n -= m[0]; } });
      return s;
    }
    async function renderTable(tbl, into) {
      var table = el("table", "vw-table");
      for (var tr = tbl.firstElementChild; tr; tr = tr.nextElementSibling) {
        if (tr.tagName !== "w:tr") continue;
        var row = document.createElement("tr");
        for (var tc = tr.firstElementChild; tc; tc = tc.nextElementSibling) {
          if (tc.tagName !== "w:tc") continue;
          var cell = document.createElement("td");
          var tcpr = kid(tc, "w:tcPr");
          if (tcpr) {
            var gs = kid(tcpr, "w:gridSpan"); if (gs) cell.colSpan = num(at(gs, "w:val"), 1);
            var shd = kid(tcpr, "w:shd"); if (shd && at(shd, "w:fill") && at(shd, "w:fill") !== "auto") cell.style.background = cssColor(at(shd, "w:fill"));
          }
          for (var ch = tc.firstElementChild; ch; ch = ch.nextElementSibling) {
            if (ch.tagName === "w:p") await renderPara(ch, cell);
            else if (ch.tagName === "w:tbl") await renderTable(ch, cell);
          }
          row.appendChild(cell);
        }
        table.appendChild(row);
      }
      into.appendChild(table);
    }

    var body = doc.getElementsByTagName("w:body")[0];
    for (var c = body.firstElementChild; c; c = c.nextElementSibling) {
      if (c.tagName === "w:p") await renderPara(c, page);
      else if (c.tagName === "w:tbl") await renderTable(c, page);
    }
    if (!page.textContent.trim() && !page.querySelector("img")) page.appendChild(el("p", "vw-note", "This document has no text to show."));
  }

  /* ------------------------------------------------------------------ */
  /* PowerPoint (.pptx)                                                   */
  /* ------------------------------------------------------------------ */
  async function renderPptx(buffer, host) {
    var JSZip = await global.Analyzer.loadJSZip();
    var zip = await JSZip.loadAsync(buffer);
    var presFile = zip.file("ppt/presentation.xml");
    if (!presFile) throw new Error("Couldn't read this presentation.");
    var pres = parseXml(await presFile.async("string"));
    var sz = pres.getElementsByTagName("p:sldSz")[0];
    var SW = num(at(sz, "cx"), 9144000), SH = num(at(sz, "cy"), 6858000);
    var presRels = await readRels(zip, "ppt/_rels/presentation.xml.rels");

    // theme colours
    var theme = {};
    var tf = zip.file("ppt/theme/theme1.xml");
    if (tf) {
      var tx = parseXml(await tf.async("string"));
      var cs = tx.getElementsByTagName("a:clrScheme")[0];
      kids(cs).forEach(function (c) {
        var k = kid(c);
        if (!k) return;
        theme[c.tagName.replace("a:", "")] = k.tagName === "a:srgbClr" ? at(k, "val") : (at(k, "lastClr") || "000000");
      });
    }
    var clrMap = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" };
    function resolveColor(node) {
      if (!node) return "";
      var c = kid(node, "a:srgbClr");
      if (c) return cssColor(at(c, "val"));
      c = kid(node, "a:schemeClr");
      if (c) {
        var v = at(c, "val");
        var key = clrMap[v] || v;
        return cssColor(theme[key]) || "";
      }
      c = kid(node, "a:sysClr");
      if (c) return cssColor(at(c, "lastClr")) || "";
      return "";
    }
    function fillOf(spPr) {
      if (!spPr) return "";
      var sf = kid(spPr, "a:solidFill");
      return sf ? resolveColor(sf) : "";
    }

    var master = null, masterRels = {}, masterPath = null;
    async function loadPart(path) {
      var f = zip.file(path);
      if (!f) return null;
      return parseXml(await f.async("string"));
    }
    function folder(p) { return p.split("/").slice(0, -1).join("/"); }

    // slide order
    var ids = Array.prototype.map.call(pres.getElementsByTagName("p:sldId"), function (s) { return s.getAttribute("r:id"); });
    var slidePaths = ids.map(function (id) { return presRels[id] ? normPath("ppt", presRels[id].target) : null; }).filter(Boolean);
    if (!slidePaths.length) throw new Error("This presentation has no slides.");

    /* ---- shape reading ---- */
    function xfrmOf(spPr) {
      var x = spPr ? kid(spPr, "a:xfrm") : null;
      if (!x) return null;
      var off = kid(x, "a:off"), ext = kid(x, "a:ext");
      if (!off || !ext) return null;
      return { x: num(at(off, "x"), 0), y: num(at(off, "y"), 0), w: num(at(ext, "cx"), 0), h: num(at(ext, "cy"), 0), rot: num(at(x, "rot"), 0) / 60000, flipH: at(x, "flipH") === "1" };
    }
    function phOf(sp) {
      var nv = kid(sp, "p:nvSpPr");
      var nvPr = nv ? kid(nv, "p:nvPr") : null;
      var ph = nvPr ? kid(nvPr, "p:ph") : null;
      return ph ? { type: at(ph, "type") || "", idx: at(ph, "idx") } : null;
    }
    function findPh(tree, ph) {
      if (!tree || !ph) return null;
      var list = kids(tree, "p:sp"), hit = null;
      list.forEach(function (sp) {
        var p2 = phOf(sp);
        if (!p2 || hit) return;
        if (ph.idx && p2.idx === ph.idx) hit = sp;
      });
      if (hit) return hit;
      list.forEach(function (sp) {
        var p2 = phOf(sp);
        if (!p2 || hit) return;
        var t1 = ph.type || "body", t2 = p2.type || "body";
        if (t1 === t2 || (t1 === "ctrTitle" && t2 === "title") || (t1 === "title" && t2 === "ctrTitle") || (t1 === "subTitle" && t2 === "body")) hit = sp;
      });
      return hit;
    }
    function lvlProps(lst, lvl) { return lst ? kid(lst, "a:lvl" + (lvl + 1) + "pPr") : null; }

    function renderShapes(tree, ctx, layer, tf) {
      // ctx: { layoutTree, masterTree, masterStyles, rels, zip path info, isSlide }
      kids(tree).forEach(function (node) {
        var t = node.tagName;
        if (t === "p:sp") renderSp(node, ctx, layer, tf);
        else if (t === "p:pic") renderPic(node, ctx, layer, tf);
        else if (t === "p:graphicFrame") renderFrame(node, ctx, layer, tf);
        else if (t === "p:grpSp") {
          var gp = kid(node, "p:grpSpPr"), gx = gp ? kid(gp, "a:xfrm") : null;
          var child = tf;
          if (gx) {
            var off = kid(gx, "a:off"), ext = kid(gx, "a:ext"), co = kid(gx, "a:chOff"), ce = kid(gx, "a:chExt");
            if (off && ext && co && ce) {
              var sx = num(at(ext, "cx"), 1) / (num(at(ce, "cx"), 1) || 1), sy = num(at(ext, "cy"), 1) / (num(at(ce, "cy"), 1) || 1);
              child = { sx: tf.sx * sx, sy: tf.sy * sy,
                dx: tf.dx + (num(at(off, "x"), 0) - num(at(co, "x"), 0) * sx) * tf.sx,
                dy: tf.dy + (num(at(off, "y"), 0) - num(at(co, "y"), 0) * sy) * tf.sy };
            }
          }
          renderShapes(node, ctx, layer, child);
        }
      });
    }
    function place(div, box, tf) {
      div.style.position = "absolute";
      div.style.left = ((box.x * tf.sx + tf.dx) / EMU_PX) + "px";
      div.style.top = ((box.y * tf.sy + tf.dy) / EMU_PX) + "px";
      div.style.width = (box.w * tf.sx / EMU_PX) + "px";
      div.style.height = (box.h * tf.sy / EMU_PX) + "px";
      if (box.rot) div.style.transform = "rotate(" + box.rot + "deg)";
    }

    // inherited text properties for a placeholder: [shape list style, layout ph, master ph, master txStyles]
    function inheritedLvl(chain, lvl) {
      var out = {};   // chain[0] is the most specific source and wins; later entries only fill gaps
      for (var i = chain.length - 1; i >= 0; i--) {
        var lp = lvlProps(chain[i], lvl);
        if (!lp) continue;
        var d = kid(lp, "a:defRPr");
        if (lp.hasAttribute("marL")) out.marL = num(at(lp, "marL"), 0);
        if (lp.hasAttribute("indent")) out.indent = num(at(lp, "indent"), 0);
        if (lp.hasAttribute("algn")) out.algn = at(lp, "algn");
        if (kid(lp, "a:buNone")) { out.bu = false; }
        else if (kid(lp, "a:buChar")) { out.bu = true; out.buChar = at(kid(lp, "a:buChar"), "char"); }
        else if (kid(lp, "a:buAutoNum")) { out.bu = true; out.buChar = "•"; }
        if (d) {
          if (d.hasAttribute("sz")) out.sz = num(at(d, "sz"), 0) / 100;
          if (d.hasAttribute("b")) out.b = at(d, "b") === "1";
          var col = kid(d, "a:solidFill"); if (col) out.color = resolveColor(col);
        }
      }
      return out;
    }
    function lstOf(sp) { var tb = kid(sp, "p:txBody"); return tb ? kid(tb, "a:lstStyle") : null; }

    function renderSp(sp, ctx, layer, tf) {
      var ph = phOf(sp);
      if (!ctx.isSlide && ph) return;                         // placeholders on layout / master are templates, not content
      var spPr = kid(sp, "p:spPr");
      var box = xfrmOf(spPr), lph = null, mph = null;
      if (ph) {
        lph = findPh(ctx.layoutTree, ph);
        mph = findPh(ctx.masterTree, ph);
        if (!box && lph) box = xfrmOf(kid(lph, "p:spPr"));
        if (!box && mph) box = xfrmOf(kid(mph, "p:spPr"));
      }
      if (!box) return;
      var div = el("div", "vw-shape");
      place(div, box, tf);
      var fill = fillOf(spPr);
      if (fill) div.style.background = fill;
      var ln = spPr ? kid(spPr, "a:ln") : null;
      if (ln && kid(ln, "a:solidFill")) {
        div.style.border = Math.max(1, num(at(ln, "w"), 12700) / EMU_PX) + "px solid " + (resolveColor(kid(ln, "a:solidFill")) || "#444");
      }
      var geom = spPr ? kid(spPr, "a:prstGeom") : null;
      if (geom && at(geom, "prst") === "ellipse") div.style.borderRadius = "50%";
      else if (geom && at(geom, "prst") === "roundRect") div.style.borderRadius = "14px";
      var tb = kid(sp, "p:txBody");
      if (tb && tb.getElementsByTagName("a:t").length) {
        var bp = kid(tb, "a:bodyPr");
        var li = num(at(bp, "lIns"), 91440), ti = num(at(bp, "tIns"), 45720), ri = num(at(bp, "rIns"), 91440), bi = num(at(bp, "bIns"), 45720);
        div.style.padding = (ti / EMU_PX) + "px " + (ri / EMU_PX) + "px " + (bi / EMU_PX) + "px " + (li / EMU_PX) + "px";
        div.style.boxSizing = "border-box";
        div.style.display = "flex"; div.style.flexDirection = "column";
        var anchor = at(bp, "anchor");
        div.style.justifyContent = anchor === "ctr" ? "center" : anchor === "b" ? "flex-end" : "flex-start";
        var scaleFont = 1;
        var na = bp ? kid(bp, "a:normAutofit") : null;
        if (na && at(na, "fontScale")) scaleFont = num(at(na, "fontScale"), 100000) / 100000;
        var phType = ph ? (ph.type || "body") : "";
        var isTitle = phType === "title" || phType === "ctrTitle";
        var styleKey = isTitle ? "p:titleStyle" : (ph && phType !== "sldNum" && phType !== "dt" && phType !== "ftr") ? "p:bodyStyle" : "p:otherStyle";
        var paras = kids(tb, "a:p"), counters = {};
        paras.forEach(function (p) {
          var ppr = kid(p, "a:pPr");
          var lvl = ppr && at(ppr, "lvl") ? Number(at(ppr, "lvl")) : 0;
          var chain = [ctx.masterStyles ? kid(ctx.masterStyles, styleKey) : null, lph ? lstOf(lph) : null, mph ? lstOf(mph) : null, lstOf(sp)];
          var base = inheritedLvl([chain[3], chain[1], chain[2], chain[0]], lvl);   // most specific first
          var algn = ppr && at(ppr, "algn") ? at(ppr, "algn") : base.algn;
          var bu = base.bu, buChar = base.buChar || "•";
          if (ppr) {
            if (kid(ppr, "a:buNone")) bu = false;
            else if (kid(ppr, "a:buChar")) { bu = true; buChar = at(kid(ppr, "a:buChar"), "char") || "•"; }
          }
          if (bu === undefined) bu = false;
          var marL = ppr && ppr.hasAttribute("marL") ? num(at(ppr, "marL"), 0) : (base.marL || 0);
          var indent = ppr && ppr.hasAttribute("indent") ? num(at(ppr, "indent"), 0) : (base.indent || 0);
          var block = el("div", "vw-sp-p"), buSpan = null;
          block.style.textAlign = algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "just" ? "justify" : "left";
          block.style.marginLeft = (marL / EMU_PX) + "px";
          if (bu) { block.style.paddingLeft = (Math.max(0, -indent) / EMU_PX) + "px"; block.style.textIndent = (indent / EMU_PX) + "px"; buSpan = el("span", "", (buChar === "§" || buChar === "Ø" ? "•" : buChar) + " "); block.appendChild(buSpan); }
          var fallbackSz = isTitle ? (phType === "ctrTitle" ? 44 : 36) : phType === "subTitle" ? 24 : ph ? 20 : 18;
          var any = false;
          Array.prototype.forEach.call(p.childNodes, function (r) {
            if (r.nodeType !== 1) return;
            if (r.tagName === "a:r" || r.tagName === "a:fld") {
              var rp = kid(r, "a:rPr"), tEl = kid(r, "a:t");
              if (!tEl) return;
              var span = el("span", "", tEl.textContent);
              var size = rp && at(rp, "sz") ? num(at(rp, "sz"), 0) / 100 : (base.sz || fallbackSz);
              span.style.fontSize = (size * scaleFont * 96 / 72) + "px";
              var color = rp ? resolveColor(kid(rp, "a:solidFill")) : "";
              span.style.color = color || base.color || "#1a1a1a";
              var bold = rp && rp.hasAttribute("b") ? at(rp, "b") === "1" : base.b;
              if (bold) span.style.fontWeight = "700";
              if (rp && at(rp, "i") === "1") span.style.fontStyle = "italic";
              if (rp && at(rp, "u") && at(rp, "u") !== "none") span.style.textDecoration = "underline";
              var lat = rp ? kid(rp, "a:latin") : null;
              if (lat && at(lat, "typeface") && at(lat, "typeface").charAt(0) !== "+") span.style.fontFamily = cssFont(at(lat, "typeface"));
              block.appendChild(span); any = true;
            } else if (r.tagName === "a:br") block.appendChild(document.createElement("br"));
          });
          if (buSpan && buSpan.nextSibling && buSpan.nextSibling.style) { buSpan.style.fontSize = buSpan.nextSibling.style.fontSize; buSpan.style.color = buSpan.nextSibling.style.color; }
          if (!any) { block.style.minHeight = ((base.sz || fallbackSz) * 96 / 72 * scaleFont) + "px"; }
          div.appendChild(block);
        });
      }
      layer.appendChild(div);
    }

    function renderPic(pic, ctx, layer, tf) {
      var spPr = kid(pic, "p:spPr"), box = xfrmOf(spPr);
      var blip = pic.getElementsByTagName("a:blip")[0];
      var rid = blip ? blip.getAttribute("r:embed") : null;
      if (!box || !rid || !ctx.rels[rid]) return;
      var holder = el("div", "vw-pic");
      place(holder, box, tf);
      layer.appendChild(holder);
      var path = normPath(ctx.folder, ctx.rels[rid].target);
      ctx.pending.push(imageUrl(zip, path).then(function (url) {
        if (!url) return;
        var img = document.createElement("img");
        img.src = url; img.alt = "";
        img.style.width = "100%"; img.style.height = "100%"; img.style.objectFit = "fill";
        if (box.flipH) img.style.transform = "scaleX(-1)";
        holder.appendChild(img);
      }));
    }

    function renderFrame(fr, ctx, layer, tf) {
      var xf = kid(fr, "p:xfrm");
      var off = xf ? kid(xf, "a:off") : null, ext = xf ? kid(xf, "a:ext") : null;
      if (!off || !ext) return;
      var box = { x: num(at(off, "x"), 0), y: num(at(off, "y"), 0), w: num(at(ext, "cx"), 0), h: num(at(ext, "cy"), 0), rot: 0 };
      var tbl = fr.getElementsByTagName("a:tbl")[0];
      var holder = el("div", "vw-shape");
      place(holder, box, tf);
      if (tbl) {
        var table = el("table", "vw-ptable");
        kids(tbl, "a:tr").forEach(function (tr) {
          var row = document.createElement("tr");
          kids(tr, "a:tc").forEach(function (tc) {
            var cell = document.createElement("td");
            var txt = [];
            Array.prototype.forEach.call(tc.getElementsByTagName("a:p"), function (p) {
              var s = ""; Array.prototype.forEach.call(p.getElementsByTagName("a:t"), function (t) { s += t.textContent; });
              txt.push(s);
            });
            cell.textContent = txt.join("\n");
            var tcPr = kid(tc, "a:tcPr"); var f = fillOf(tcPr); if (f) cell.style.background = f;
            cell.style.fontSize = "16px";
            row.appendChild(cell);
          });
          table.appendChild(row);
        });
        holder.appendChild(table);
      } else {
        holder.classList.add("vw-unsupported");
        holder.textContent = "Chart or object — open the downloaded file to see it";
      }
      layer.appendChild(holder);
    }

    /* ---- build slides ---- */
    var list = el("div", "vw-slides");
    host.appendChild(list);
    var fits = [];
    for (var si = 0; si < slidePaths.length; si++) {
      var sPath = slidePaths[si];
      var sx2 = await loadPart(sPath);
      if (!sx2) continue;
      var sFolder = folder(sPath);
      var sRels = await readRels(zip, sFolder + "/_rels/" + sPath.split("/").pop() + ".rels");
      var layoutPath = null;
      Object.keys(sRels).forEach(function (k) { if (/slideLayout$/.test(sRels[k].type)) layoutPath = normPath(sFolder, sRels[k].target); });
      var layoutDoc = layoutPath ? await loadPart(layoutPath) : null;
      var lRels = layoutPath ? await readRels(zip, folder(layoutPath) + "/_rels/" + layoutPath.split("/").pop() + ".rels") : {};
      var mPath = null;
      Object.keys(lRels).forEach(function (k) { if (/slideMaster$/.test(lRels[k].type)) mPath = normPath(folder(layoutPath), lRels[k].target); });
      var masterDoc = mPath ? await loadPart(mPath) : null;
      var mRels = mPath ? await readRels(zip, folder(mPath) + "/_rels/" + mPath.split("/").pop() + ".rels") : {};
      var cmEl = masterDoc ? masterDoc.getElementsByTagName("p:clrMap")[0] : null;
      if (cmEl) ["bg1", "tx1", "bg2", "tx2"].forEach(function (k) { if (at(cmEl, k)) clrMap[k] = at(cmEl, k); });

      var layoutTree = layoutDoc ? kid(kid(layoutDoc.documentElement, "p:cSld"), "p:spTree") : null;
      var masterTree = masterDoc ? kid(kid(masterDoc.documentElement, "p:cSld"), "p:spTree") : null;
      var slideTree = kid(kid(sx2.documentElement, "p:cSld"), "p:spTree");
      var masterStyles = masterDoc ? kid(masterDoc.documentElement, "p:txStyles") : null;

      var wrap = el("div", "vw-slide-wrap");
      var slide = el("div", "vw-slide");
      slide.style.width = (SW / EMU_PX) + "px"; slide.style.height = (SH / EMU_PX) + "px";
      // background: slide, then layout, then master
      var bg = "#ffffff";
      [sx2, layoutDoc, masterDoc].some(function (d) {
        if (!d) return false;
        var b = d.getElementsByTagName("p:bg")[0];
        if (!b) return false;
        var pr = kid(b, "p:bgPr"), ref = kid(b, "p:bgRef");
        var c = pr ? fillOf(pr) : ref ? resolveColor(ref) : "";
        if (c) { bg = c; return true; }
        return false;
      });
      slide.style.background = bg;
      var pending = [];
      var ident = { sx: 1, sy: 1, dx: 0, dy: 0 };
      if (masterTree) renderShapes(masterTree, { isSlide: false, layoutTree: null, masterTree: null, masterStyles: null, rels: mRels, folder: folder(mPath), pending: pending }, slide, ident);
      if (layoutTree) renderShapes(layoutTree, { isSlide: false, layoutTree: null, masterTree: null, masterStyles: null, rels: lRels, folder: folder(layoutPath), pending: pending }, slide, ident);
      renderShapes(slideTree, { isSlide: true, layoutTree: layoutTree, masterTree: masterTree, masterStyles: masterStyles, rels: sRels, folder: sFolder, pending: pending }, slide, ident);
      await Promise.all(pending);
      wrap.appendChild(slide);
      var label = el("div", "vw-slide-label", "Slide " + (si + 1) + " of " + slidePaths.length);
      var card = el("div", "vw-slide-card");
      card.appendChild(wrap); card.appendChild(label);
      list.appendChild(card);
      fits.push({ wrap: wrap, slide: slide, w: SW / EMU_PX, h: SH / EMU_PX });
    }
    function fit() {
      fits.forEach(function (f) {
        var k = f.wrap.clientWidth / f.w;
        if (!k) return;
        f.slide.style.transform = "scale(" + k + ")";
        f.slide.style.transformOrigin = "top left";
        f.wrap.style.height = (f.h * k) + "px";
      });
    }
    fit();
    if ("ResizeObserver" in global) new ResizeObserver(fit).observe(host); else global.addEventListener("resize", fit);
    host.appendChild(el("div", "vw-note", "Charts, animations and special effects aren't shown here. Use Download to see the original."));
  }

  /* ------------------------------------------------------------------ */
  /* the window                                                           */
  /* ------------------------------------------------------------------ */
  /** opts: { title, ext, getUrl: () => Promise<string|null>, onDownload?: fn } */
  function open(opts) {
    var overlay = el("div", "modal-overlay vw-overlay");
    var card = el("div", "modal-card vw-card");
    card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true");
    var head = el("div", "modal-head");
    var h = el("h3", "vw-title", opts.title || "File");
    var close = el("button", "modal-close"); close.type = "button"; close.setAttribute("aria-label", "Close"); close.textContent = "✕";
    head.appendChild(h); head.appendChild(close);
    var bodyEl = el("div", "vw-body");
    var status = el("div", "vw-status", "Opening file…");
    bodyEl.appendChild(status);
    var content = el("div", "vw-content");
    bodyEl.appendChild(content);
    var foot = el("div", "modal-foot split");
    if (opts.onDownload) { var dl = el("button", "btn btn-ghost small", "Download"); dl.type = "button"; dl.addEventListener("click", opts.onDownload); foot.appendChild(dl); }
    var done = el("button", "btn btn-primary small", "Close"); done.type = "button"; foot.appendChild(done);
    card.appendChild(head); card.appendChild(bodyEl); card.appendChild(foot);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    var closed = false;
    function shut() {
      closed = true;
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      blobUrls.splice(0).forEach(function (u) { URL.revokeObjectURL(u); });
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) { if (e.key === "Escape") shut(); }
    document.addEventListener("keydown", onKey);
    close.addEventListener("click", shut); done.addEventListener("click", shut);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) shut(); });
    function setStatus(t) { status.textContent = t; status.style.display = t ? "block" : "none"; }
    function failMsg(t) { setStatus(""); content.innerHTML = ""; content.appendChild(el("div", "vw-fail", t)); }

    var ext = (opts.ext || "").toLowerCase();
    (async function () {
      try {
        if (ext === "doc" || ext === "ppt") {
          return failMsg("Older ." + ext + " files can't be shown here. Use Download to open it in " + (ext === "doc" ? "Word" : "PowerPoint") + ".");
        }
        var url = await opts.getUrl();
        if (closed) return;
        if (!url) return failMsg("Couldn't open that file. It may have been removed, or you may not have access to it.");
        if (["png", "jpg", "jpeg", "webp", "gif"].indexOf(ext) !== -1) {
          var img = document.createElement("img");
          img.className = "vw-image"; img.alt = opts.title || "";
          img.onload = function () { setStatus(""); };
          img.onerror = function () { failMsg("This image couldn't be shown."); };
          img.src = url;
          content.appendChild(img);
          return;
        }
        var res = await fetch(url);
        if (!res.ok) throw new Error("Couldn't download the file (" + res.status + ").");
        var buf = await res.arrayBuffer();
        if (closed) return;
        setStatus("Drawing…");
        if (ext === "pdf") await renderPdf(buf, content, setStatus);
        else if (ext === "docx") await renderDocx(buf, content);
        else if (ext === "pptx") await renderPptx(buf, content);
        else return failMsg("This kind of file can't be shown here. Use Download.");
        setStatus("");
      } catch (e) {
        if (!closed) failMsg((e && e.message) || "This file couldn't be shown. Use Download instead.");
      }
    })();
    return { close: shut };
  }

  global.Viewer = { open: open };
})(window);
