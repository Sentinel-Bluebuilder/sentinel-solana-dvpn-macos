// ─── UI audit: the design rubric, checked on the live window ───
// Injected by the UI smoke after every screen (src/main/dev/ui-smoke.ts) and pasteable into
// DevTools. Returns { screen, width, height, total, counts, edges, violations }; a screen
// passes with 0 violations. Rules: docs/DESIGN.md "Type", "Layout", "Tables".
/* global document, window, getComputedStyle */
(() => {
  const v = [];
  const describe = (el) => {
    if (!el || !el.tagName) return '';
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    return `${el.tagName.toLowerCase()}${cls}`;
  };
  const add = (rule, el, detail) => v.push({ rule, el: describe(el), detail });
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const main = document.querySelector('main');
  const screen = (document.querySelector('nav[aria-label="Main"] [aria-current="page"]')?.textContent ?? 'setup').trim();

  // ─── colour helpers (contrast) ───
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const lum = ({ r, g, b }) => {
    const f = (x) => {
      x /= 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const canvas = parse(getComputedStyle(document.body).backgroundColor) || { r: 10, g: 11, b: 13, a: 1 };
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) stack.push(c);
      if (c && c.a === 1) break;
    }
    let bg = { ...canvas, a: 1 };
    for (const c of stack.reverse()) bg = over(c, bg);
    return bg;
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  const FONTS = /^(Outfit Variable|Outfit|Tomorrow|JetBrains Mono Variable)$/;
  const SCALE = new Set([10, 12, 14, 18, 20, 24, 36]);

  // ─── 1. fonts loaded ───
  for (const f of document.fonts) if (f.status === 'loaded' && !FONTS.test(f.family.replace(/"/g, ''))) add('font-loaded', document.body, f.family);

  // ─── 2. text: family, scale, weight, case, contrast ───
  // Logos (role=img) are pictures, not text.
  const all = [...document.querySelectorAll('body *')].filter((el) => !el.closest('svg, canvas, [aria-hidden="true"], .fi, [role="img"]'));
  for (const el of all) {
    if (!ownText(el) || !visible(el)) continue;
    const s = getComputedStyle(el);
    const fam = s.fontFamily.split(',')[0].replace(/"/g, '').trim();
    if (!FONTS.test(fam)) add('font-family', el, fam);
    const px = parseFloat(s.fontSize);
    if (px < 10) add('font-size<10', el, `${px}px`);
    else if (!SCALE.has(Math.round(px))) add('type-scale', el, `${px}px "${el.textContent.trim().slice(0, 20)}"`);
    const w = Number(s.fontWeight);
    if (/^Outfit/.test(fam) && w >= 700) add('bold-body', el, `${w} "${el.textContent.trim().slice(0, 20)}"`);
    if (s.textTransform === 'uppercase' && px > 10.5 && !el.closest('.devnet-badge')) add('shouty', el, `${px}px "${el.textContent.trim().slice(0, 20)}"`);
    if (el.closest('[disabled], [aria-disabled="true"]')) continue;
    const fg = parse(s.color);
    if (fg && fg.a > 0) {
      const bg = bgOf(el);
      const r = ratio(over(fg, bg), bg);
      const large = px >= 18 || (px >= 14 && w >= 700);
      if (r < (large ? 3 : 4.5)) add('contrast', el, `${r.toFixed(2)} "${el.textContent.trim().slice(0, 24)}"`);
    }
  }

  // ─── 3. tables: header row, numbers right + tabular, nothing centered ───
  for (const t of document.querySelectorAll('main table')) if (visible(t) && !t.querySelector('th')) add('table-no-header', t, '');
  for (const td of document.querySelectorAll('main td, main th')) {
    if (!visible(td)) continue;
    const s = getComputedStyle(td);
    const t = td.textContent.trim();
    if (s.textAlign === 'center') add('table-center', td, t.slice(0, 20));
    const numeric = /\d/.test(t) && /^[-+$≈~]?[\d.,]+\s*(%|ms|B|KB|MB|GB|TB|tDVPN|SOL|Mbps|h|s)?$/.test(t);
    if (td.tagName === 'TD' && numeric) {
      if (!/right|end/.test(s.textAlign)) add('num-align', td, t);
      if (!/tabular-nums/.test(s.fontVariantNumeric)) add('num-tabular', td, t);
    }
  }

  // ─── 4. controls: one height family (40 controls, 32 tabs/chips/compact) ───
  for (const b of document.querySelectorAll('main button, main select, main input:not([type=checkbox]):not([type=radio]):not([type=range]), nav button')) {
    if (!visible(b) || b.closest('[role="radiogroup"] [role="radio"], table, [role="log"]')) continue;
    const h = Math.round(b.getBoundingClientRect().height);
    if (!b.matches('.btn, .btn-primary, .btn-ghost, .btn-danger, .input, .tab, .chip, select, input')) continue;
    if (![32, 40].includes(h) && !(b.closest('nav') && h === 40)) add('control-height', b, `${h}px "${b.textContent.trim().slice(0, 16)}"`);
  }

  // ─── 5. text budget ───
  for (const p of document.querySelectorAll('main p')) {
    if (!visible(p) || p.closest('[role="dialog"], [role="log"]')) continue;
    const n = p.textContent.trim().length;
    if (n > 160) add('wall-of-text', p, `${n} chars`);
    const s = getComputedStyle(p);
    const lines = Math.max(1, Math.round(p.getBoundingClientRect().height / (parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.5)));
    if (lines > 1 && n / lines > 90) add('line-length', p, `${Math.round(n / lines)} chars/line`);
  }

  // ─── 6. spacing on the 4 px grid ───
  const props = ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'rowGap', 'columnGap'];
  let off = 0;
  for (const el of all) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    for (const k of props) {
      const px = parseFloat(s[k]);
      if (!Number.isFinite(px) || px <= 2) continue;
      // An auto margin (ml-auto, mt-auto) pushes things apart; its size is not a spacing choice.
      if (k.startsWith('margin') && /(^| )(m[tlrbxy]?-auto)( |$)/.test(el.getAttribute('class') ?? '')) continue;
      if (Math.abs(px - Math.round(px / 4) * 4) > 0.5 && ++off <= 15) add('spacing-grid', el, `${k} ${px}px`);
    }
  }

  // ─── 7. layout: no sideways scroll, page edges, empty first viewport ───
  const edges = {};
  if (main) {
    if (main.scrollWidth > main.clientWidth + 1) add('h-overflow', main, `${main.scrollWidth} > ${main.clientWidth}`);
    const page = main.querySelector(':scope > .page') || main.lastElementChild;
    if (page) {
      const r = page.getBoundingClientRect();
      const m = main.getBoundingClientRect();
      edges.left = Math.round(r.left - m.left);
      edges.right = Math.round(m.right - r.right);
      edges.width = Math.round(r.width);
      // a screen that does not scroll must fill at least 70% of the window height
      if (main.scrollHeight <= main.clientHeight + 1) {
        let bottom = m.top;
        for (const el of page.querySelectorAll('*')) if (visible(el)) bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
        const used = (bottom - m.top) / m.height;
        edges.used = Math.round(used * 100);
        if (used < 0.7) add('empty-viewport', page, `${Math.round((1 - used) * 100)}% of the window empty`);
      }
      // unused band on the right: content narrower than the container allows
      // A centred column (equal margins, within 16 px) is the layout; only a one-sided band is ragged.
      if (edges.right > 64 + 48 && Math.abs(edges.right - edges.left) > 16) add('ragged-edge', page, `${edges.right}px empty on the right`);
    }
  }

  const counts = {};
  for (const x of v) counts[x.rule] = (counts[x.rule] || 0) + 1;
  return { screen, width: window.innerWidth, height: window.innerHeight, total: v.length, counts, edges, violations: v.slice(0, 60) };
})();
