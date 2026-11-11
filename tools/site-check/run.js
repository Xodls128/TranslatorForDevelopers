'use strict';

/*
 * 공식 문서 사이트 점검 (가짜 번역기)
 *
 * 실제 공식 문서 페이지를 열고 확장 스크립트를 넣어, 점검표 항목 중 자동으로 판단할 수 있는 것을 확인한다.
 * 번역 품질과 속도는 실제 Chrome 번역기가 필요해서 여기서는 보지 않는다.
 * 외부 사이트에 의존하므로 테스트가 아니라 진단 도구다: 결과를 보고만 하고 실패로 끝내지 않는다.
 *
 * 실행:  npm run site-check                 (전체)
 *        npm run site-check -- react python (일부)
 * 결과:  site-check-results/results.json, summary.md, shots/*.png
 *
 * 항목 번호는 점검표(1~21)와 같다. 추가 항목: "주석"(코드 블록 주석 번역), "라벨"(경고 상자 라벨 분리)
 */
const path = require('node:path');
const fs = require('node:fs');
const { launchBrowser } = require('../../test/e2e/browser');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'site-check-results');
const SHOTS = path.join(OUT, 'shots');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const SCRIPTS = manifest.content_scripts[0].js.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'));
const CSS = fs.readFileSync(path.join(ROOT, 'src/content/content.css'), 'utf8');

const SITES = [
  ['mdn', 'MDN', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Closures'],
  ['react', 'react.dev', 'https://react.dev/reference/react/useEffect'],
  ['vue', 'Vue', 'https://vuejs.org/guide/essentials/reactivity-fundamentals.html'],
  ['python', 'Python', 'https://docs.python.org/3/tutorial/classes.html'],
  ['rust', 'Rust std', 'https://doc.rust-lang.org/std/vec/struct.Vec.html'],
  ['spring', 'Spring', 'https://docs.spring.io/spring-framework/reference/core/beans/introduction.html'],
  ['k8s', 'Kubernetes', 'https://kubernetes.io/docs/concepts/workloads/pods/'],
  ['kernel', 'Linux 커널', 'https://docs.kernel.org/core-api/kernel-api.html'],
  ['espidf', 'ESP-IDF', 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/gpio.html'],
  ['rpi', 'Raspberry Pi', 'https://www.raspberrypi.com/documentation/computers/raspberry-pi.html'],
];

const COLUMNS = ['1', '2', '3', '4', '5', '7', '9', '11', '12', '14', '15', '17', '18', '21', '주석', '라벨'];
const SYMBOL = { ok: '✓', part: '△', fail: '✗', na: '–' };

// 받은 문장 앞에 [ko]를 붙여 돌려주는 가짜 번역기
const FAKE_TRANSLATOR = `
  window.__translated = [];
  Object.defineProperty(window, 'Translator', { configurable: true, value: {
    availability: async () => 'available',
    create: async () => ({ translate: async (t) => { window.__translated.push(t); return '[ko] ' + t; } }),
  } });
`;

// 페이지 안에서 쓰는 도우미
function installHelpers() {
  // 본문 영역: 앞 선택자부터 차례로 (선택자 목록 하나로 찾으면 문서 순서상 먼저 나오는 메뉴가 잡힘)
  const root = ['main .vt-doc', 'main', '[role=main]', 'article', '.document', '.body', '#content', '.content']
    .map((q) => document.querySelector(q)).find(Boolean) || document.body;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 50 && r.height > 8 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const english = (el, min = 60) => {
    const t = el.textContent.trim();
    return t.length >= min && (t.match(/[A-Za-z]/g) || []).length > t.length * 0.5;
  };
  const touched = (el) => !!(el.closest('.tfd-copy, [data-tfd-hidden]') || el.querySelector('.tfd-copy, [data-tfd-hidden], .tfd-sentence'));
  const BOX = '.admonition, aside, [class*="callout"], .custom-block, .alert, [role="note"], .notecard, .admonitionblock, blockquote';
  window.__chk = {
    root, visible, english, touched, BOX,
    shown: (el) => (el.closest('[data-tfd-hidden]') ? el.closest('[data-tfd-hidden]').previousElementSibling : el),
    paragraphs: () => [...root.querySelectorAll('p')].filter((p) => visible(p) && english(p, 80) && p.textContent.length < 900 &&
      !p.closest('nav, header, footer, aside, pre, table, ' + BOX) && !touched(p)),
  };
}

async function inject(page) {
  await page.addStyleTag({ content: CSS });
  for (const src of SCRIPTS) await page.addScriptTag({ content: src });
  await page.evaluate(installHelpers);
}

const exists = (page, handle) => page.evaluate((x) => !!x, handle);

async function shot(handle, name) {
  try {
    const el = handle && handle.asElement();
    if (el) await el.screenshot({ path: path.join(SHOTS, name), timeout: 5000 });
  } catch {
    // 스크린샷은 참고용이라 실패해도 점검은 계속한다.
  }
}

/**
 * a부터 b(없으면 a)까지 드래그한 것처럼 선택하고 번역 버튼을 누른다.
 * 스크롤하면 번역 버튼이 숨겨지므로(의도된 동작) 스크롤이 끝난 뒤에 드래그한다.
 */
async function dragTranslate(page, a, b) {
  await page.evaluate((a) => a.scrollIntoView({ block: 'center', behavior: 'instant' }), a);
  await page.waitForTimeout(400);
  await page.evaluate(([a, b]) => {
    b = b || a;
    const range = document.createRange();
    range.setStart(a, 0);
    range.setEnd(b, b.childNodes.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true, clientX: ra.left + 2, clientY: ra.top + 2 }));
    b.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true, clientX: Math.max(rb.right - 2, ra.left + 40), clientY: rb.bottom - 2 }));
  }, [a, b]);
  await page.waitForTimeout(150);
  const button = await page.evaluate(() => !document.getElementById('tfd-ui-host').shadowRoot.querySelector('.button').hidden);
  if (!button) return { button: false, inputs: [] };
  const before = await page.evaluate(() => window.__translated.length);
  await page.evaluate(() => document.getElementById('tfd-ui-host').shadowRoot.querySelector('.button').click());
  try {
    await page.waitForFunction(() => {
      const r = document.getElementById('tfd-ui-host').shadowRoot;
      const msg = r.querySelector('.toast .message').textContent;
      return !r.querySelector('.card').hidden || (msg && !/번역 중|다운로드/.test(msg));
    }, null, { timeout: 20000 });
  } catch {
    return { button: true, done: false, inputs: [] };
  }
  return page.evaluate((before) => {
    const r = document.getElementById('tfd-ui-host').shadowRoot;
    const link = r.querySelector('.toast .link');
    return {
      button: true,
      done: true,
      toast: r.querySelector('.toast .message').textContent,
      card: r.querySelector('.card').hidden ? null : r.querySelector('.card .title').textContent,
      link: link && !link.hidden ? link.href : null,
      inputs: window.__translated.slice(before),
    };
  }, before);
}

const mark = (ok, partial) => (ok ? 'ok' : partial ? 'part' : 'fail');

async function checkSite(browser, [id, name, url]) {
  const res = { id, name, url, items: {}, notes: [], error: null };
  const set = (n, m, note) => (res.items[n] = { mark: m, note });
  const notFound = (n, what) => set(n, 'na', `${what}을(를) 찾지 못함`);
  const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  const page = await context.newPage();
  const errors = [];
  let injected = false;
  page.on('pageerror', (e) => injected && errors.push(String(e.message || e)));
  page.on('console', (m) => injected && m.type() === 'error' && errors.push('console: ' + m.text()));
  await page.addInitScript(FAKE_TRANSLATOR);

  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    res.status = response && response.status();
    await page.waitForTimeout(2500); // 하이드레이션 대기
    const title = await page.title();
    if (/Just a moment|Attention Required|Access denied/i.test(title)) throw new Error(`사이트의 봇 차단(보안 확인 페이지)에 막힘: ${title}`);
    const dupBefore = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
      return [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
    });
    await inject(page);
    injected = true;

    // ---------- 1~5: 본문 첫 문단 ----------
    const p1 = await page.evaluateHandle(() => window.__chk.paragraphs()[0] || null);
    if (!(await exists(page, p1))) throw new Error('번역할 본문 문단을 찾지 못함');
    const before = await page.evaluate((p) => {
      p.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = p.getBoundingClientRect();
      const cs = getComputedStyle(p);
      return {
        x: r.left, w: r.width, h: r.height,
        style: [cs.fontSize, cs.fontFamily.split(',')[0], cs.lineHeight, cs.marginTop, cs.marginBottom, cs.color],
        codes: [...p.querySelectorAll('code')].map((c) => c.textContent),
        links: [...p.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
      };
    }, p1);
    await page.waitForTimeout(300);
    await shot(p1, `${id}-1-before.png`);
    const t1 = await dragTranslate(page, p1);
    set(1, mark(t1.button), t1.button ? '' : '본문 문단을 드래그해도 번역 버튼이 뜨지 않음');
    const after = await page.evaluate((p) => {
      const copy = window.__chk.shown(p);
      const spans = [...copy.querySelectorAll('.tfd-sentence')];
      const r = copy.getBoundingClientRect();
      const cs = getComputedStyle(copy);
      return {
        mirrored: copy !== p,
        hidden: p.hasAttribute('data-tfd-hidden') && getComputedStyle(p).display === 'none',
        translated: spans.filter((s) => s.dataset.tfdState === 'translated').length,
        pending: spans.filter((s) => s.dataset.tfdState === 'pending').length,
        total: spans.length,
        x: r.left, w: r.width, h: r.height,
        style: [cs.fontSize, cs.fontFamily.split(',')[0], cs.lineHeight, cs.marginTop, cs.marginBottom, cs.color],
        codes: [...copy.querySelectorAll('code')].map((c) => c.textContent),
        links: [...copy.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
        terms: [...copy.querySelectorAll('.tfd-term')].map((t) => t.textContent),
        codeTokens: [...copy.querySelectorAll('.tfd-code')].map((t) => t.textContent),
      };
    }, p1);
    if (t1.done) await shot(await page.evaluateHandle((p) => window.__chk.shown(p), p1), `${id}-2-after.png`);
    set(2, mark(t1.done && after.translated > 0 && after.pending === 0 && !t1.card, after.translated > 0),
      `${after.translated}/${after.total}문장 번역${t1.card ? `, 안내 카드: ${t1.card}` : ''}${after.mirrored ? ' (문단 사본)' : ' (그 자리)'}`);
    const dx = Math.abs(after.x - before.x);
    const dw = Math.abs(after.w - before.w);
    const sameStyle = JSON.stringify(after.style) === JSON.stringify(before.style);
    set(3, (after.mirrored ? after.hidden && dx <= 2 && dw <= 2 && sameStyle : sameStyle) ? 'ok' : 'part',
      `위치·폭 차이 ${dx.toFixed(0)}/${dw.toFixed(0)}px, 높이 ${before.h.toFixed(0)}→${after.h.toFixed(0)}px, ${sameStyle ? '글꼴·여백·색 같음' : '스타일 다름'} (스크린샷으로 확인)`);
    res.notes.push(`보존된 용어: ${after.terms.join(', ') || '(없음)'}`, `태그 없는 코드로 보존: ${after.codeTokens.join(', ') || '(없음)'}`);

    const swap = await page.evaluate(async (p) => {
      const span = window.__chk.shown(p).querySelector('.tfd-sentence[data-tfd-state="translated"]');
      if (!span) return null;
      const r = span.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(span);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      span.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left + 2, clientY: r.top + 2 }));
      span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: r.left + 60, clientY: r.top + 4 }));
      await new Promise((ok) => setTimeout(ok, 120));
      const dragged = span.dataset.tfdState; // 드래그는 그대로 (선택·복사)
      getSelection().removeAllRanges();
      span.click();
      await new Promise((ok) => setTimeout(ok, 400)); // 클릭 전환은 더블클릭 구분을 위해 0.3초 뒤
      const clicked = span.dataset.tfdState;
      span.click();
      await new Promise((ok) => setTimeout(ok, 400));
      return [dragged, clicked, span.dataset.tfdState];
    }, p1);
    set(4, mark(swap && swap[0] === 'translated' && swap[1] === 'original' && swap[2] === 'translated'), swap ? `드래그 후 ${swap[0]}, 클릭 후 ${swap[1]}, 다시 클릭 후 ${swap[2]}` : '번역문이 없어 확인 못 함');

    const peek = await page.evaluate(async (p) => {
      const copy = window.__chk.shown(p);
      if (copy === p) return null;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
      await new Promise((ok) => setTimeout(ok, 450));
      const during = getComputedStyle(p).display !== 'none' && getComputedStyle(copy).display === 'none';
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
      await new Promise((ok) => setTimeout(ok, 50));
      return { during, after: getComputedStyle(p).display === 'none' && getComputedStyle(copy).display !== 'none' };
    }, p1);
    set(5, peek ? mark(peek.during && peek.after) : 'na', peek ? `누르는 동안 원본 ${peek.during ? '보임' : '안 보임'}, 떼면 ${peek.after ? '번역본' : '원본 그대로'}` : '그 자리 번역');

    const codesKept = before.codes.every((c) => after.codes.includes(c));
    if (before.codes.length) set(7, mark(codesKept), `<code> ${before.codes.length}개 ${codesKept ? '그대로' : '일부 바뀜'}`);
    else set(7, 'na', '첫 문단에 <code> 없음');
    const hrefsKept = before.links.every((h) => after.links.includes(h));
    if (before.links.length) set(9, mark(hrefsKept), `링크 ${before.links.length}개 주소 ${hrefsKept ? '유지' : '일부 바뀜'} (클릭 이동은 사람이 확인)`);
    else set(9, 'na', '첫 문단에 링크 없음');

    // ---------- 11: 제목 + 이어지는 문단 (이미 번역한 문단을 가로지르지 않는 구간) ----------
    const sec = await page.evaluateHandle(() => {
      for (const h of window.__chk.root.querySelectorAll('h2, h3')) {
        if (!window.__chk.visible(h) || h.closest('nav, header, footer, aside')) continue;
        let n = h.nextElementSibling;
        for (let i = 0; n && i < 3; i++, n = n.nextElementSibling) {
          if (window.__chk.touched(n)) break; // 번역문 위를 끌면 원문 전환이 되므로 피한다
          const p = n.matches('p') ? n : n.querySelector('p');
          if (p && window.__chk.english(p, 60)) return [h, p];
        }
      }
      return null;
    });
    if (await exists(page, sec)) {
      const h = await page.evaluateHandle((s) => s[0], sec);
      const p = await page.evaluateHandle((s) => s[1], sec);
      const html = await page.evaluate((h) => h.outerHTML, h);
      const t = await dragTranslate(page, h, p);
      const r = await page.evaluate(([h, p, html]) => ({
        same: h.outerHTML === html,
        done: !!window.__chk.shown(p).querySelector('.tfd-sentence[data-tfd-state="translated"]'),
        text: h.textContent.trim().slice(0, 50),
      }), [h, p, html]);
      set(11, mark(r.same && r.done, r.same), `제목 "${r.text}" ${r.same ? '그대로' : '바뀜'}, 이어지는 문단 ${r.done ? '번역됨' : '번역 안 됨'}${t.button ? '' : ' (번역 버튼 안 뜸)'}`);
    } else notFound(11, '제목과 이어지는 문단');

    // ---------- 12 + 라벨: 경고 상자 ----------
    const box = await page.evaluateHandle(() => [...window.__chk.root.querySelectorAll(window.__chk.BOX)]
      .find((b) => window.__chk.visible(b) && !window.__chk.touched(b) && b.querySelector('p') && window.__chk.english(b, 40)) || null);
    if (await exists(page, box)) {
      const info = await page.evaluate((b) => {
        const label = b.querySelector('.admonition-title, .custom-block-title, .alert-heading, .admonitionblock .title, [class*="admonitionHeading"], strong, h3, h4');
        return { cls: String(b.className || b.tagName).slice(0, 40), label: label ? label.textContent.trim().replace(/:$/, '') : '' };
      }, box);
      await shot(box, `${id}-3-box-before.png`);
      const t = await dragTranslate(page, box);
      const done = await page.evaluate((b) => window.__chk.shown(b).querySelectorAll('.tfd-sentence[data-tfd-state="translated"]').length +
        [...document.querySelectorAll('.tfd-copy')].filter((c) => b.contains(c)).reduce((n, c) => n + c.querySelectorAll('.tfd-sentence[data-tfd-state="translated"]').length, 0), box);
      await shot(await page.evaluateHandle((b) => window.__chk.shown(b), box), `${id}-4-box-after.png`);
      set(12, mark(done > 0), `상자(${info.cls}) ${done}문장 번역${t.button ? '' : ' (번역 버튼 안 뜸)'} — 자연스러운지는 스크린샷으로 확인`);
      if (info.label && !/[:：]$/.test(info.label)) {
        const merged = t.inputs.find((s) => s.startsWith(info.label + ' ') && s.length > info.label.length + 2);
        set('라벨', merged ? 'fail' : 'ok', merged ? `라벨이 본문과 합쳐짐: "${merged.slice(0, 50)}"` : `라벨 "${info.label}"과 본문이 따로 번역기에 전달됨`);
      } else set('라벨', 'na', info.label ? `라벨에 콜론이 있음("${info.label}:") — 한 문장이어도 자연스러움` : '라벨 없음');
    } else {
      notFound(12, '경고 상자');
      notFound('라벨', '경고 상자');
    }

    // ---------- 14: API 시그니처 + 설명 ----------
    const api = await page.evaluateHandle(() => {
      for (const sig of window.__chk.root.querySelectorAll('.code-header, dt.sig, dt[id], .method-signature')) {
        if (!window.__chk.visible(sig) || window.__chk.touched(sig)) continue;
        const next = sig.nextElementSibling || (sig.parentElement && sig.parentElement.nextElementSibling);
        const p = next && (next.matches('p, dd') ? next : next.querySelector('p'));
        if (p && window.__chk.english(p, 30) && !window.__chk.touched(p)) return [sig, p];
      }
      return null;
    });
    if (await exists(page, api)) {
      const sig = await page.evaluateHandle((a) => a[0], api);
      const p = await page.evaluateHandle((a) => a[1], api);
      const text = await page.evaluate((s) => s.textContent, sig);
      const t = await dragTranslate(page, sig, p);
      const r = await page.evaluate(([s, p, text]) => ({
        same: s.textContent === text && !s.querySelector('.tfd-sentence'),
        desc: window.__chk.shown(p).querySelectorAll('.tfd-sentence[data-tfd-state="translated"]').length,
      }), [sig, p, text]);
      set(14, mark(r.same && r.desc > 0, r.desc > 0), `시그니처 "${text.trim().replace(/\s+/g, ' ').slice(0, 50)}" ${r.same ? '그대로' : '바뀜'}, 설명 ${r.desc}문장 번역${t.button ? '' : ' (번역 버튼 안 뜸)'}`);
    } else notFound(14, 'API 시그니처');

    // ---------- 15: 문단 + 코드 블록을 같이 드래그 → 코드 블록은 그대로 ----------
    const cb = await page.evaluateHandle(() => {
      for (const pre of window.__chk.root.querySelectorAll('pre')) {
        if (!window.__chk.visible(pre) || window.__chk.touched(pre)) continue;
        let node = pre;
        let prev = pre.previousElementSibling;
        while (!prev && node.parentElement && node.parentElement !== window.__chk.root) {
          node = node.parentElement;
          prev = node.previousElementSibling;
        }
        if (prev && prev.matches('p') && window.__chk.english(prev, 30) && !window.__chk.touched(prev)) return [prev, pre];
      }
      return null;
    });
    if (await exists(page, cb)) {
      const p = await page.evaluateHandle((c) => c[0], cb);
      const pre = await page.evaluateHandle((c) => c[1], cb);
      const html = await page.evaluate((pre) => pre.outerHTML, pre);
      const t = await dragTranslate(page, p, pre);
      const same = await page.evaluate(([pre, html]) => pre.outerHTML === html && !document.querySelector('pre.tfd-copy'), [pre, html]);
      set(15, mark(same), `문단과 같이 드래그해도 코드 블록 ${same ? '그대로' : '바뀜'}${t.button ? '' : ' (번역 버튼 안 뜸)'}`);
    } else notFound(15, '문단 바로 뒤의 코드 블록');

    // ---------- 주석: 코드 블록 안에서만 드래그 → 주석만 번역 ----------
    const commented = await page.evaluateHandle(() => [
      ...window.__chk.root.querySelectorAll('pre'),
      ...[...window.__chk.root.querySelectorAll('*')].filter((el) => el.shadowRoot).flatMap((el) => [...el.shadowRoot.querySelectorAll('pre')]),
    ].find((pre) => {
      if (!window.__chk.visible(pre) || window.__chk.touched(pre)) return false;
      const range = document.createRange();
      range.selectNodeContents(pre);
      return window.TFD.hasCommentsToTranslate(pre, range);
    }) || null);
    if (await exists(page, commented)) {
      const beforeText = await page.evaluate((pre) => pre.innerText, commented);
      const t = await dragTranslate(page, commented);
      const afterText = await page.evaluate((pre) => window.__chk.shown(pre).innerText, commented);
      const b = beforeText.split('\n');
      const a = afterText.split('\n');
      const stripComment = (line) => (line || '').replace(/(\/\/|#|<!--|\/\*|\*|--).*$/, '');
      const changed = b.filter((line, i) => line !== a[i]).length;
      const codeChanged = b.filter((line, i) => stripComment(line) !== stripComment(a[i])).length;
      await shot(await page.evaluateHandle((pre) => window.__chk.shown(pre), commented), `${id}-5-comments.png`);
      set('주석', mark(t.done && changed > 0 && codeChanged === 0 && a.length === b.length, changed > 0),
        `${t.toast || '번역 안 됨'} 줄 수 ${b.length}→${a.length}, 바뀐 줄 ${changed}, 코드 부분이 바뀐 줄 ${codeChanged}`);
    } else notFound('주석', '영어 주석이 있는 코드 블록');

    // ---------- 17: 앵커 ----------
    const anchors = await page.evaluate((dupBefore) => {
      const ids = [...window.__chk.root.querySelectorAll('h2[id], h3[id], h2 [id], h3 [id]')].map((e) => e.id).slice(0, 30);
      const hidden = ids.filter((v) => { const el = document.getElementById(v); return !el || el.closest('[data-tfd-hidden]'); });
      const all = [...document.querySelectorAll('[id]')].map((e) => e.id);
      const dup = [...new Set(all.filter((v, i) => all.indexOf(v) !== i))].filter((v) => !dupBefore.includes(v));
      return { ids: ids.length, hidden: hidden.length, dup };
    }, dupBefore);
    if (anchors.ids) set(17, mark(anchors.hidden === 0, true), `제목 앵커 ${anchors.ids}개 중 숨겨진 대상 ${anchors.hidden}개, 사본 때문에 새로 생긴 중복 id ${anchors.dup.length}개`);
    else set(17, 'na', '제목 앵커 없음');

    // ---------- 18: 공식 한국어판 ----------
    const ko = await page.evaluate(() => window.TFD.findKoreanEdition(document));
    if (ko) set(18, t1.link ? 'ok' : 'part', `한국어판 링크 ${ko}${t1.link ? ', 첫 번역 알림에 표시됨' : ', 알림에는 안 뜸'}`);
    else res.notes.push('페이지에 한국어판 링크(hreflang="ko") 없음 — 실제 한국어판이 있는지는 사람이 확인');

    // ---------- 21: 콘솔 오류 ----------
    const ours = errors.filter((e) => /TFD|tfd-|sentence|mirror|translat/i.test(e));
    set(21, mark(ours.length === 0, true), `주입 후 오류 ${errors.length}개, 우리 코드 관련으로 보이는 것 ${ours.length}개`);
    res.errors = errors.slice(0, 10);
  } catch (e) {
    res.error = String(e.message || e).split('\n')[0];
  }
  await context.close();
  return res;
}

function summarize(results) {
  const lines = [
    '# 공식 문서 사이트 점검 (가짜 번역기)',
    '',
    `실행: ${new Date().toISOString()} · ✓ 잘 됨 · △ 일부 문제 · ✗ 안 됨 · – 대상 없음`,
    '',
    `| 사이트 | ${COLUMNS.join(' | ')} |`,
    `|---|${COLUMNS.map(() => ':-:').join('|')}|`,
  ];
  for (const r of results) {
    const cells = r.error ? COLUMNS.map(() => ' ') : COLUMNS.map((c) => (r.items[c] ? SYMBOL[r.items[c].mark] || '·' : ' '));
    lines.push(`| ${r.name} | ${cells.join(' | ')} |`);
  }
  lines.push('', '## 메모', '');
  for (const r of results) {
    lines.push(`### ${r.name}`, '');
    if (r.error) lines.push(`- 점검 못 함: ${r.error}`);
    for (const [n, v] of Object.entries(r.items)) if (v.mark !== 'ok' || /확인/.test(v.note)) lines.push(`- ${n} ${SYMBOL[v.mark]} ${v.note}`);
    for (const note of r.notes) lines.push(`- ${note}`);
    lines.push('');
  }
  return lines.join('\n');
}

(async () => {
  const only = process.argv.slice(2);
  const unknown = only.filter((id) => !SITES.some(([s]) => s === id));
  if (unknown.length) {
    console.error(`모르는 사이트: ${unknown.join(', ')} (가능: ${SITES.map(([s]) => s).join(', ')})`);
    process.exit(2);
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await launchBrowser();
  const results = [];
  for (const site of SITES) {
    if (only.length && !only.includes(site[0])) continue;
    const t0 = Date.now();
    const r = await checkSite(browser, site);
    r.ms = Date.now() - t0;
    results.push(r);
    const row = r.error ? `점검 못 함: ${r.error}` : COLUMNS.map((c) => `${c}${r.items[c] ? SYMBOL[r.items[c].mark] : '·'}`).join(' ');
    console.log(`${site[1].padEnd(12)} ${row}`);
  }
  await browser.close();
  const summary = summarize(results);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, 'summary.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  console.log(`\n결과: ${path.relative(ROOT, OUT)}/summary.md`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
