'use strict';

/*
 * 코드 블록 안 주석 번역: 하이라이터 종류별(Pygments 클래스 / Shiki 글자색만 / CodeMirror 줄 div) 코드 블록에서
 * 드래그한 줄의 주석만 번역되고 코드와 줄 수는 그대로인지 확인한다.
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

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>code</title>
<style>pre { font: 13px monospace; } .cm-line { display: block; }</style></head><body>
<p id="intro">Classes provide a means of bundling data and functionality together.</p>
<pre id="py"><span class="k">class</span> <span class="nc">Dog</span>:
    <span class="n">kind</span> <span class="o">=</span> <span class="s1">'canine'</span>  <span class="c1"># class variable shared by all instances</span>
<span class="c1"># Function defined outside</span>
<span class="c1"># the class body</span>
<span class="k">def</span> <span class="nf">f1</span>(<span class="n">x</span>): <span class="k">return</span> <span class="n">x</span></pre>
<div class="language-js"><pre id="shiki" class="shiki"><code><span class="line"><span style="color:#6A737D">// mounted is a lifecycle hook</span></span>
<span class="line"><span style="color:#F97583">const</span><span style="color:#E1E4E8"> url = "https://example.com" </span><span style="color:#6A737D">// => 1</span></span>
<span class="line"><span style="color:#6A737D">/* The block comment</span></span>
<span class="line"><span style="color:#6A737D"> * spans two lines */</span></span>
<span class="line"><span style="color:#E1E4E8">run()</span></span></code></pre></div>
<pre id="cm" class="sp-cm"><code><div class="cm-line"><span class="sp-syntax-keyword">const</span> <span class="sp-syntax-plain">a</span> = <span class="sp-syntax-static">1</span>;</div><div class="cm-line"><span class="sp-syntax-comment">// Connect to the chat server</span></div><div class="cm-line"><span class="sp-syntax-plain">connect</span>();</div></code></pre>
<div class="language-bash"><pre id="sh"><code># apt install curl
$ ls</code></pre></div>
</body></html>`;

const FAKE = `
  window.__translated = [];
  window.Translator = {
    availability: async () => 'available',
    create: async () => ({ translate: async (t) => { window.__translated.push(t); return '[ko] ' + t; } }),
  };
`;

let browser;
let page;

test.before(async () => {
  browser = await launchBrowser();
  page = await browser.newPage();
  await page.route('https://docs.example.dev/code', (route) => route.fulfill({ contentType: 'text/html', body: HTML }));
  await page.addInitScript(FAKE);
  await page.goto('https://docs.example.dev/code');
  for (const file of contentScripts) await page.addScriptTag({ path: path.join(ROOT, file) });
  await page.addStyleTag({ path: path.join(ROOT, 'src/content/content.css') });
});

test.after(async () => {
  await browser.close();
});

// root 안에서 startText부터 endText까지 드래그한 것처럼 선택한다. (endRoot가 있으면 거기까지)
async function select(rootSel, startText, endText, endRootSel) {
  await page.evaluate(({ rootSel, startText, endText, endRootSel }) => {
    const find = (root, text, atEnd) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.data.indexOf(text);
        if (i !== -1) return [n, atEnd ? i + text.length : i];
      }
      throw new Error('not found: ' + text);
    };
    const visible = (sel) => [...document.querySelectorAll(sel)].find((el) => getComputedStyle(el).display !== 'none');
    const root = visible(rootSel);
    const endRoot = endRootSel ? visible(endRootSel) : root;
    const range = document.createRange();
    range.setStart(...find(root, startText, false));
    range.setEnd(...find(endRoot, endText, true));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    root.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    endRoot.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 40 }));
  }, { rootSel, startText, endText, endRootSel });
  await page.waitForTimeout(60);
}

const buttonShown = () => page.evaluate(() => !document.getElementById('tfd-ui-host').shadowRoot.querySelector('.button').hidden);

async function translate() {
  await page.locator('#tfd-ui-host .button').click();
  await page.waitForFunction(() => /번역했습니다|찾지 못했습니다/.test(document.getElementById('tfd-ui-host').shadowRoot.querySelector('.toast .message').textContent));
  return page.evaluate(() => document.getElementById('tfd-ui-host').shadowRoot.querySelector('.toast .message').textContent);
}

// 보이는 쪽(사본이 있으면 사본) 코드 블록의 글자
const shownText = (id) => page.evaluate((id) => [...document.querySelectorAll(`#${id}`)].find((el) => getComputedStyle(el).display !== 'none').innerText, id);

test('문단과 코드 블록을 같이 드래그하면 문단만 번역하고 코드 블록은 그대로 둔다', async () => {
  const before = await page.evaluate(() => document.getElementById('py').outerHTML);
  await select('#intro', 'Classes', 'class body', '#py');
  assert.equal(await buttonShown(), true);
  await translate();
  assert.deepEqual(await page.evaluate(() => window.__translated.splice(0)), ['Classes provide a means of bundling data and functionality together.']);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#py').length), 1, '코드 블록 사본을 만들지 않음');
  assert.equal(await page.evaluate(() => document.getElementById('py').outerHTML), before);
});

test('Pygments(클래스): 드래그한 줄의 주석만, 이어지는 주석 줄은 한 문장으로 번역하고 줄 수를 유지한다', async () => {
  const before = await shownText('py');
  await select('#py', 'kind', 'class body');
  assert.equal(await buttonShown(), true);
  const toast = await translate();
  assert.match(toast, /주석 2개를 번역했습니다/);
  assert.deepEqual(await page.evaluate(() => window.__translated.splice(0)), [
    '⟦0⟧ variable shared by all instances', // 주석 안의 개발 용어(class)도 보존
    'Function defined outside the class body',
  ]);
  const after = await shownText('py');
  const b = before.split('\n');
  const a = after.split('\n');
  assert.equal(a.length, b.length);
  assert.equal(a[0], b[0]); // 코드 줄은 그대로
  assert.equal(a[4], b[4]);
  assert.equal(a[1], "    kind = 'canine'  # [ko] class variable shared by all instances");
  // 두 줄 묶음은 번역문을 두 줄에 나눠 넣는다 (# 기호는 그대로)
  assert.match(a[2], /^# \S/);
  assert.match(a[3], /^# \S/);
  assert.equal(a[2].slice(2) + ' ' + a[3].slice(2), '[ko] Function defined outside the class body');
  // 원본은 숨겨지고 사본이 보인다
  assert.equal(await page.evaluate(() => document.querySelectorAll('#py').length), 2);
});

test('번역된 주석: 드래그하면 원문, 클릭하면 번역문', async () => {
  await select('#py', '[ko] class', 'instances');
  assert.equal(await page.evaluate(() => document.querySelector('pre.tfd-copy .tfd-sentence').dataset.tfdState), 'original');
  await page.evaluate(() => { getSelection().removeAllRanges(); document.querySelector('pre.tfd-copy .tfd-sentence').click(); });
  assert.equal(await page.evaluate(() => document.querySelector('pre.tfd-copy .tfd-sentence').dataset.tfdState), 'translated');
});

test('Shiki(글자색만, language-js): 주석 기호로 찾고, 문자열 안 //와 영어 없는 주석은 건드리지 않는다', async () => {
  await select('#shiki', 'mounted', 'run()');
  assert.equal(await buttonShown(), true);
  await translate();
  assert.deepEqual(await page.evaluate(() => window.__translated.splice(0)), ['mounted is a lifecycle hook', 'The block comment spans two lines']);
  const lines = (await shownText('shiki')).split('\n');
  assert.equal(lines.length, 5);
  assert.equal(lines[0], '// [ko] mounted is a lifecycle hook');
  assert.equal(lines[1], 'const url = "https://example.com" // => 1');
  assert.match(lines[2], /^\/\* \S/);
  assert.match(lines[3], /^ \* \S.* \*\/$/);
  assert.equal(lines[4], 'run()');
});

test('CodeMirror(줄이 div): 줄 구조를 인식해 그 줄의 주석만 번역한다', async () => {
  await select('#cm', 'const', 'connect');
  await translate();
  assert.deepEqual(await page.evaluate(() => window.__translated.splice(0)), ['Connect to the chat server']);
  const lines = (await shownText('cm')).split('\n').filter(Boolean);
  assert.deepEqual(lines, ['const a = 1;', '// [ko] Connect to the chat server', 'connect();']);
});

test('셸 블록(#이 프롬프트일 수 있음)과 주석이 없는 줄에서는 번역 버튼이 뜨지 않는다', async () => {
  await select('#sh', 'apt', 'ls');
  assert.equal(await buttonShown(), false);
  await select('#cm', 'connect', 'connect');
  assert.equal(await buttonShown(), false);
});
