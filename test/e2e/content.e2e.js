'use strict';

/*
 * content script를 실제 Chromium 페이지에 넣어 드래그 → 번역 → 복원 흐름을 확인한다.
 * 헤드리스 Chromium에는 Translator API가 없으므로 토큰을 그대로 두는 가짜 번역기를 넣는다.
 *
 * 실행: npm run test:e2e
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const contentScripts = manifest.content_scripts[0].js;

const FAKE_TRANSLATOR = `
  window.__translated = [];
  window.__opened = [];
  window.open = (url) => { window.__opened.push(url); return null; };
  window.Translator = {
    availability: async () => 'available',
    create: async () => ({
      translate: async (text) => {
        window.__translated.push(text);
        // "A ⟦0⟧ ..." → "⟦0⟧는 ..." 처럼 조사를 붙여 조사 병기 처리를 확인한다.
        return '[ko] ' + text.replace(/^A (⟦\\d+⟧)/, '$1는');
      },
    }),
  };
`;

let browser;
let page;

async function select(selector, startText, endText) {
  // 요소 안 텍스트에서 startText 시작 ~ endText 끝까지 선택하고, 드래그를 끝낸 것처럼 mouseup을 보낸다.
  await page.evaluate(({ selector, startText, endText }) => {
    const rootEl = document.querySelector(selector);
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let started = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!started && node.data.includes(startText)) {
        range.setStart(node, node.data.indexOf(startText));
        started = true;
      }
      if (started && node.data.includes(endText)) {
        range.setEnd(node, node.data.indexOf(endText) + endText.length);
        break;
      }
    }
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    rootEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, { selector, startText, endText });
  await page.waitForTimeout(50);
}

async function buttonVisible() {
  return page.evaluate(() => !document.getElementById('tfd-ui-host').shadowRoot.querySelector('.button').hidden);
}

async function clickTranslate() {
  await page.locator('#tfd-ui-host .button').click();
  await page.waitForFunction(() => !document.getElementById('tfd-ui-host').shadowRoot.querySelector('.toast').textContent.includes('번역 중'));
}

const html = (selector) => page.$eval(selector, (el) => el.innerHTML);

test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.addInitScript(FAKE_TRANSLATOR);
  await page.goto('file://' + path.join(__dirname, 'fixture.html'));
  for (const file of contentScripts) await page.addScriptTag({ path: path.join(ROOT, file) });
  await page.addStyleTag({ path: path.join(ROOT, 'src/content/content.css') });
});

test.after(async () => {
  await browser.close();
});

test('영어 드래그 → 번역 버튼 → 걸친 문장만 번역, 코드/링크/용어 보존', async () => {
  const original = await html('#p1');
  // 첫 문장 중간 ~ 둘째 문장 중간까지 드래그 (<code>를 가로지름)
  await select('#p1', 'can call', 'It returns');
  assert.equal(await buttonVisible(), true);
  await clickTranslate();

  const sentences = await page.$$eval('#p1 .tfd-sentence', (els) => els.map((el) => el.textContent));
  assert.deepEqual(sentences, [
    '[ko] closure은(는) can call fetch() at any time.',
    '[ko] It returns a Promise object.',
  ]);
  // <code>와 <a>는 원래 요소 그대로(복제본) 들어간다.
  assert.equal(await page.$eval('#p1 .tfd-sentence code', (el) => el.textContent), 'fetch()');
  assert.equal(await page.$eval('#p1 .tfd-sentence a', (el) => el.getAttribute('href')), '#promise');
  // 번역기에는 토큰이 들어간 문장이 전달된다.
  const sent = await page.evaluate(() => window.__translated);
  assert.deepEqual(sent, ['A ⟦0⟧ can call ⟦1⟧ at any time.', 'It returns a ⟦0⟧ object.']);

  // 번역된 부분을 드래그하면 바로 원문으로 복원된다.
  await select('#p1', '[ko] It', 'returns');
  assert.equal(await page.$$eval('#p1 .tfd-sentence', (els) => els.length), 1);
  assert.equal(await buttonVisible(), false);
  await select('#p1', '[ko]', 'can call');
  assert.equal(await page.$$eval('#p1 .tfd-sentence', (els) => els.length), 0);
  assert.equal(await html('#p1'), original);
});

test('여러 줄과 <strong>에 걸친 문장도 한 문장으로 번역하고 원래 DOM으로 복원', async () => {
  const original = await html('#p1');
  await select('#p1', 'spans', 'bold');
  await clickTranslate();
  const sentences = await page.$$eval('#p1 .tfd-sentence', (els) => els.map((el) => el.textContent));
  assert.deepEqual(sentences, ['[ko] This sentence spans lines and has bold text inside.']);

  await select('#p1', '[ko] This', 'spans');
  assert.equal(await html('#p1'), original);
  assert.equal(await page.$eval('#p1 strong', (el) => el.textContent), 'bold text');
});

test('inline-block 배지는 통째로 보존', async () => {
  await select('#p1', 'Final', 'here');
  await clickTranslate();
  assert.equal(await page.$eval('#p1 .tfd-sentence .badge', (el) => el.textContent), 'new');
  await select('#p1', '[ko] Final', 'one');
});

test('제목형 문장은 다의어 용어도 보존, 용어 클릭 시 검색 페이지 열기', async () => {
  await select('#title', 'Structures', 'Unions');
  await clickTranslate();
  const terms = await page.$$eval('#title .tfd-term', (els) => els.map((el) => el.dataset.term));
  assert.deepEqual(terms, ['structure', 'union']);

  await page.locator('#title .tfd-term').nth(1).click();
  const opened = await page.evaluate(() => window.__opened);
  assert.deepEqual(opened, ['https://www.google.com/search?q=' + encodeURIComponent('프로그래밍언어 union')]);
});

test('약어 e.g. 에서 문장을 끊지 않는다', async () => {
  await select('#li1', 'First', 'Set');
  await clickTranslate();
  const sentences = await page.$$eval('#li1 .tfd-sentence', (els) => els.map((el) => el.textContent));
  assert.deepEqual(sentences, ['[ko] First item, e.g. Map or Set.']);
});

test('<pre> 코드 블록과 한국어 문단은 번역 버튼이 떠도 번역하지 않는다', async () => {
  const before = await page.evaluate(() => window.__translated.length);
  await select('#code', 'const', 'price');
  if (await buttonVisible()) await clickTranslate();
  assert.equal(await page.$$eval('#code .tfd-sentence', (els) => els.length), 0);

  await select('#ko', '이미', '문단입니다');
  assert.equal(await buttonVisible(), false);
  assert.equal(await page.evaluate(() => window.__translated.length), before);
});
