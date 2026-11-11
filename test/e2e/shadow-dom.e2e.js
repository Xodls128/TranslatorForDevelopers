'use strict';

/*
 * 열린 Shadow DOM 대응 (MDN처럼 코드 예제와 언어 메뉴가 웹 컴포넌트 안에 있는 사이트)
 * - Shadow DOM 안 코드 블록을 실제 마우스로 드래그하면 주석만 번역하고, 번역문 스타일도 적용된다
 * - 번역된 주석: 드래그하면 그대로, 클릭하면 원문, 다시 클릭하면 번역문
 * - 언어 메뉴(Shadow DOM)의 "한국어" 링크를 한국어판으로 안내한다. 다른 사이트로 가는 "한국어" 링크는 무시한다
 *
 * 실행: npm run test:e2e
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { launchBrowser } = require('./browser');

const ROOT = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const contentScripts = manifest.content_scripts[0].js;

// MDN의 <mdn-code-example>, <mdn-language-switcher>를 흉내 낸 웹 컴포넌트
const page = (switcherLink) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>shadow</title>
<style>body { font: 16px sans-serif; margin: 40px; } </style></head><body>
<test-switcher></test-switcher>
<p id="intro">Closures are a powerful feature of the language.</p>
<test-code></test-code>
<script>
  customElements.define('test-code', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = '<style>pre { font: 14px monospace; padding: 8px; }</style>' +
        '<pre class="brush: js"><span class="token keyword">function</span> init() {\\n' +
        '  <span class="token keyword">var</span> name = "Mozilla"; <span class="token comment">// name is a local variable</span>\\n' +
        '  <span class="token comment">// displayName() is the inner function</span>\\n' +
        '}</pre>';
    }
  });
  customElements.define('test-switcher', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = '<ul><li><a href="/ja/docs/closures">日本語</a></li><li>${switcherLink}</li></ul>';
    }
  });
</script>
</body></html>`;

const FAKE = `
  window.__translated = [];
  window.Translator = {
    availability: async () => 'available',
    create: async () => ({ translate: async (t) => { window.__translated.push(t); return '[ko] ' + t; } }),
  };
`;

let browser;

test.before(async () => {
  browser = await launchBrowser();
});

test.after(async () => {
  await browser.close();
});

async function open(switcherLink) {
  const p = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await p.route('https://docs.example.dev/en-US/docs/closures', (route) => route.fulfill({ contentType: 'text/html', body: page(switcherLink) }));
  await p.addInitScript(FAKE);
  await p.goto('https://docs.example.dev/en-US/docs/closures');
  for (const file of contentScripts) await p.addScriptTag({ path: path.join(ROOT, file) });
  await p.addStyleTag({ path: path.join(ROOT, 'src/content/content.css') });
  return p;
}

// Shadow DOM 안 코드 블록의 보이는 쪽(사본이 있으면 사본) 사각형
const preBox = (p) => p.evaluate(() => {
  const pre = [...document.querySelector('test-code').shadowRoot.querySelectorAll('pre')].find((e) => getComputedStyle(e).display !== 'none');
  const r = pre.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});

async function mouseDrag(p, from, to) {
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(100);
}

const toast = (p) => p.evaluate(() => document.getElementById('tfd-ui-host').shadowRoot.querySelector('.toast .message').textContent);

test('Shadow DOM 안 코드 블록: 실제 드래그로 주석만 번역, 스타일 적용, 원문 전환, 한국어판 안내', async () => {
  const p = await open('<a href="/ko/docs/closures">한국어</a>');
  const box = await preBox(p);
  await mouseDrag(p, { x: box.x + 10, y: box.y + 12 }, { x: box.x + 300, y: box.y + box.h - 12 });
  assert.equal(await p.evaluate(() => !document.getElementById('tfd-ui-host').shadowRoot.querySelector('.button').hidden), true, '번역 버튼이 뜬다');

  await p.locator('#tfd-ui-host .button').click();
  await p.waitForFunction(() => /번역했습니다/.test(document.getElementById('tfd-ui-host').shadowRoot.querySelector('.toast .message').textContent));
  assert.deepEqual(await p.evaluate(() => window.__translated.splice(0)), ['name is a local variable', 'displayName() is the inner function'].map((t) => t.replace('displayName()', '⟦0⟧')));
  assert.match(await toast(p), /주석 2개를 번역했습니다/);
  assert.match(await toast(p), /공식 한국어판/);
  assert.equal(await p.evaluate(() => document.getElementById('tfd-ui-host').shadowRoot.querySelector('.toast .link').href), 'https://docs.example.dev/ko/docs/closures');

  const shown = await p.evaluate(() => {
    const root = document.querySelector('test-code').shadowRoot;
    const pres = [...root.querySelectorAll('pre')];
    const copy = pres.find((e) => e.classList.contains('tfd-copy'));
    const span = copy.querySelector('.tfd-sentence');
    return { count: pres.length, originalHidden: getComputedStyle(pres.find((e) => !e.classList.contains('tfd-copy'))).display, text: copy.innerText, background: getComputedStyle(span).backgroundColor };
  });
  assert.equal(shown.count, 2);
  assert.equal(shown.originalHidden, 'none');
  assert.equal(shown.text, 'function init() {\n  var name = "Mozilla"; // [ko] name is a local variable\n  // [ko] displayName() is the inner function\n}');
  assert.equal(shown.background, 'rgba(255, 196, 0, 0.16)', 'Shadow root에 넣은 스타일로 번역문 배경이 보인다');

  // 번역된 주석을 드래그하면 그대로, 클릭하면 원문, 다시 클릭하면 번역문
  const span = await p.evaluate(() => {
    const s = document.querySelector('test-code').shadowRoot.querySelector('pre.tfd-copy .tfd-sentence');
    const r = s.getBoundingClientRect();
    return { x: r.left, y: r.top + r.height / 2, w: r.width };
  });
  await mouseDrag(p, { x: span.x + 2, y: span.y }, { x: span.x + span.w - 2, y: span.y });
  const stateOf = () => p.evaluate(() => document.querySelector('test-code').shadowRoot.querySelector('pre.tfd-copy .tfd-sentence').dataset.tfdState);
  assert.equal(await stateOf(), 'translated');
  await p.mouse.click(span.x + 5, span.y);
  await p.waitForTimeout(400);
  assert.equal(await stateOf(), 'original');
  await p.mouse.click(span.x + 5, span.y);
  await p.waitForTimeout(400);
  assert.equal(await stateOf(), 'translated');
  await p.close();
});

test('다른 사이트로 가는 "한국어" 링크는 한국어판으로 보지 않는다', async () => {
  const p = await open('<a href="https://elsewhere.example.org/ko/">한국어</a>');
  const box = await p.evaluate(() => { const r = document.getElementById('intro').getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
  await mouseDrag(p, { x: box.x + 2, y: box.y }, { x: box.x + box.w - 2, y: box.y });
  await p.locator('#tfd-ui-host .button').click();
  await p.waitForFunction(() => /번역했습니다/.test(document.getElementById('tfd-ui-host').shadowRoot.querySelector('.toast .message').textContent));
  assert.doesNotMatch(await toast(p), /한국어판/);
  await p.close();
});
