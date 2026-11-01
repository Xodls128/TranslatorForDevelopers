'use strict';

/*
 * 분야 묶음과 검색 맥락: 테스트 페이지를 실제 문서 사이트 주소로 띄워 확인한다.
 * (Playwright가 그 주소 요청을 가로채 테스트 HTML을 돌려주므로 네트워크는 쓰지 않는다)
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

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>site</title></head><body>
  <p id="p">Write the register before the interrupt fires.</p>
</body></html>`;

// 설정(window.__sync)을 넣을 수 있는 가짜 chrome.storage, 받은 문장을 그대로 돌려주는 가짜 번역기, 새 탭 기록
const FAKE = `
  const area = (data) => ({
    async get(keys) { return keys && typeof keys === 'object' && !Array.isArray(keys) ? { ...keys, ...data } : { ...data }; },
    async set(items) { Object.assign(data, items); },
    async remove() {}, async getBytesInUse() { return 0; },
  });
  window.chrome = { storage: { local: area({}), sync: area(window.__sync || {}), onChanged: { addListener() {} } } };
  window.__translated = [];
  window.Translator = {
    availability: async () => 'available',
    create: async () => ({ translate: async (text) => { window.__translated.push(text); return '[ko] ' + text; } }),
  };
  window.__opened = [];
  window.open = (url) => { window.__opened.push(url); return null; };
`;

let browser;

test.before(async () => {
  browser = await launchBrowser();
});

test.after(async () => {
  await browser.close();
});

async function openAt(url, sync) {
  const page = await browser.newPage();
  await page.route(url, (route) => route.fulfill({ contentType: 'text/html', body: HTML }));
  if (sync) await page.addInitScript((s) => (window.__sync = s), sync);
  await page.addInitScript(FAKE);
  await page.goto(url);
  for (const file of contentScripts) await page.addScriptTag({ path: path.join(ROOT, file) });
  await page.addStyleTag({ path: path.join(ROOT, 'src/content/content.css') });
  await page.waitForTimeout(50); // 설정 읽기
  return page;
}

async function translate(page) {
  await page.evaluate(() => {
    const el = document.getElementById('p');
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 200, clientY: 10 }));
  });
  await page.waitForTimeout(50);
  await page.locator('#tfd-ui-host .button').click();
  await page.waitForFunction(() => document.querySelector('.tfd-sentence[data-tfd-state="translated"]'));
}

const terms = (page) => page.$$eval('.tfd-term', (els) => els.map((el) => el.dataset.term));

test('임베디드 문서 사이트: 묶음이 켜져 register·interrupt를 보존하고, 용어 검색에 사이트 맥락을 붙인다', async () => {
  const page = await openAt('https://docs.espressif.com/projects/esp-idf/en/stable/test.html');
  await translate(page);
  assert.deepEqual(await page.evaluate(() => window.__translated), ['Write the ⟦0⟧ before the ⟦1⟧ fires.']);
  assert.deepEqual(await terms(page), ['register', 'interrupt']);

  await page.locator('.tfd-term').first().click();
  assert.deepEqual(await page.evaluate(() => window.__opened), [
    'https://www.google.com/search?q=' + encodeURIComponent('ESP-IDF에서 register이란'),
  ]);
  await page.close();
});

test('표에 없는 사이트: 기본 사전만 써서 같은 문장을 그대로 번역한다', async () => {
  const page = await openAt('https://example.com/test.html');
  await translate(page);
  assert.deepEqual(await page.evaluate(() => window.__translated), ['Write the register before the interrupt fires.']);
  await page.close();
});

test('옵션의 "항상 켤 묶음": 표에 없는 사이트에서도 켜진다', async () => {
  const page = await openAt('https://example.com/test.html', { packsAlways: ['embedded'] });
  await translate(page);
  assert.deepEqual(await terms(page), ['register', 'interrupt']);
  await page.close();
});

test('옵션의 자동 켜기를 끄면 문서 사이트에서도 묶음을 쓰지 않는다', async () => {
  const page = await openAt('https://docs.espressif.com/test.html', { packsAuto: false });
  await translate(page);
  assert.deepEqual(await terms(page), []);
  await page.close();
});
