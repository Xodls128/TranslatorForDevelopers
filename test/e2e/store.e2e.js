'use strict';

/*
 * 번역 결과 기기 저장: 페이지를 새로 열어도 같은 문장은 번역기를 부르지 않는다.
 * 테스트 페이지에는 chrome.storage가 없으므로, 확장 스크립트보다 먼저 가짜 chrome.storage를 넣는다.
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

// local: 번역 기록이 들어가는 곳, sync: 사용자 설정. 미리 넣을 값은 window.__seed로 받는다.
const FAKE_CHROME = `
  const seed = window.__seed || { local: {}, sync: {} };
  const area = (data) => ({
    data,
    async get(keys) {
      if (keys === null) return { ...data };
      if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));
      return { ...keys, ...data }; // 기본값 객체로 조회
    },
    async set(items) { Object.assign(data, items); },
    async remove(keys) { for (const k of keys) delete data[k]; },
    async getBytesInUse(keys) {
      const list = keys === null ? Object.keys(data) : keys.filter((k) => k in data);
      return list.reduce((sum, k) => sum + k.length + JSON.stringify(data[k]).length, 0);
    },
  });
  window.chrome = { storage: { local: area(seed.local), sync: area(seed.sync), onChanged: { addListener() {} } } };
  window.__calls = [];
  window.Translator = {
    availability: async () => 'available',
    create: async () => ({ translate: async (text) => { window.__calls.push(text); return '[ko] ' + text; } }),
  };
`;

let browser;

test.before(async () => {
  browser = await launchBrowser();
});

test.after(async () => {
  await browser.close();
});

async function openPage(seed) {
  const page = await browser.newPage();
  if (seed) await page.addInitScript((s) => (window.__seed = s), seed);
  await page.addInitScript(FAKE_CHROME);
  await page.goto('file://' + path.join(__dirname, 'fixture.html'));
  for (const file of contentScripts) await page.addScriptTag({ path: path.join(ROOT, file) });
  await page.addStyleTag({ path: path.join(ROOT, 'src/content/content.css') });
  return page;
}

async function translate(page, selector) {
  await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 200, clientY: 10 }));
  }, selector);
  await page.waitForTimeout(50);
  await page.locator('#tfd-ui-host .button').click();
  // 결과 알림이 바뀌거나, 실패 안내 카드가 뜰 때까지 기다린다.
  await page.waitForFunction(() => {
    const root = document.getElementById('tfd-ui-host').shadowRoot;
    return !root.querySelector('.card').hidden || !root.querySelector('.toast .message').textContent.includes('번역 중');
  });
}

const texts = (page, selector) => page.$$eval(`${selector} .tfd-sentence`, (els) => els.map((el) => el.textContent));

// 모아 둔 기록을 바로 쓰게 한다. (탭을 떠날 때와 같은 동작)
async function flushNow(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(50);
}

test('저장 켜짐(기본): 새로 연 페이지에서 같은 문장은 번역기를 부르지 않고 저장된 번역을 쓴다', async () => {
  const first = await openPage();
  await translate(first, '#li1');
  assert.equal(await first.evaluate(() => window.__calls.length), 2);
  await flushNow(first);
  const saved = await first.evaluate(() => window.chrome.storage.local.data);
  assert.equal(Object.keys(saved).length, 2);
  assert.ok(Object.keys(saved).every((k) => k.startsWith('t:v1:')));
  await first.close();

  const second = await openPage({ local: saved, sync: {} });
  await translate(second, '#li1');
  assert.equal(await second.evaluate(() => window.__calls.length), 0);
  assert.deepEqual(await texts(second, '#li1'), ['[ko] First item, e.g. Map or Set.', '[ko] Second sentence.']);
  await second.close();
});

test('저장 꺼짐: 기록하지도 꺼내 쓰지도 않는다', async () => {
  const first = await openPage({ local: {}, sync: { saveTranslations: false } });
  await translate(first, '#li1');
  await flushNow(first);
  assert.deepEqual(await first.evaluate(() => window.chrome.storage.local.data), {});
  await first.close();
});

test('토큰이 깨져 원문으로 둔 문장은 저장하지 않는다', async () => {
  const page = await openPage();
  // 이 페이지의 번역기는 둘째 문장에서 토큰을 빼고 돌려준다.
  await page.evaluate(() => {
    window.Translator.create = async () => ({
      translate: async (text) => (text.startsWith('Second') ? '[ko] Second ⟦9⟧' : '[ko] ' + text),
    });
  });
  await translate(page, '#li1');
  await flushNow(page);
  assert.equal(Object.keys(await page.evaluate(() => window.chrome.storage.local.data)).length, 1);
  await page.close();
});
