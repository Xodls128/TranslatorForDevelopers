'use strict';

/*
 * 단계별 초기화와 번역기 미리 준비
 * - 페이지를 연 직후에는 이벤트 리스너만 있고, 버튼 UI·설정 읽기·번역기 확인을 하지 않는다.
 * - 처음 영어를 드래그하면 그때 준비한다.
 * - 번역 버튼에 마우스를 올리면, 모델이 이미 있을 때만 번역기를 미리 만든다.
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

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>lazy</title></head><body>
  <p id="p1" style="margin:40px">Write the register before the first call.</p>
  <p id="p2" style="margin:40px">Write the register again later.</p>
</body></html>`;

// 호출 횟수를 세는 가짜 chrome.storage와 번역기. window.__availability로 모델 상태를 정한다.
const FAKE = `
  window.__calls = { syncGet: 0, availability: 0, create: 0 };
  window.__changeListeners = [];
  const area = (data, count) => ({
    async get(keys) { if (count) window.__calls.syncGet++; return keys && typeof keys === 'object' && !Array.isArray(keys) ? { ...keys, ...data } : { ...data }; },
    async set(items) { Object.assign(data, items); },
    async remove() {}, async getBytesInUse() { return 0; },
  });
  window.chrome = { storage: { local: area({}), sync: area({}, true), onChanged: { addListener(fn) { window.__changeListeners.push(fn); } } } };
  window.__translated = [];
  window.Translator = {
    availability: async () => { window.__calls.availability++; return window.__availability || 'available'; },
    create: async () => { window.__calls.create++; return { translate: async (t) => { window.__translated.push(t); return '[ko] ' + t; } }; },
  };
`;

let browser;

test.before(async () => {
  browser = await launchBrowser();
});

test.after(async () => {
  await browser.close();
});

async function open(availability) {
  const page = await browser.newPage();
  await page.route('https://docs.example.dev/lazy', (route) => route.fulfill({ contentType: 'text/html', body: HTML }));
  if (availability) await page.addInitScript((a) => (window.__availability = a), availability);
  await page.addInitScript(FAKE);
  await page.goto('https://docs.example.dev/lazy');
  for (const file of contentScripts) await page.addScriptTag({ path: path.join(ROOT, file) });
  return page;
}

async function drag(page, id) {
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 200, clientY: 10 }));
  }, id);
  await page.waitForTimeout(80);
}

const calls = (page) => page.evaluate(() => ({ ...window.__calls }));
const hasUI = (page) => page.evaluate(() => !!document.getElementById('tfd-ui-host'));

async function clickAndWait(page) {
  await page.locator('#tfd-ui-host .button').click();
  await page.waitForFunction(() => /번역했습니다/.test(document.getElementById('tfd-ui-host').shadowRoot.querySelector('.toast .message').textContent));
}

test('페이지를 연 직후: 버튼 UI도 없고 설정·번역기도 건드리지 않는다', async () => {
  const page = await open();
  await page.waitForTimeout(100);
  assert.equal(await hasUI(page), false);
  assert.deepEqual(await calls(page), { syncGet: 0, availability: 0, create: 0 });
  await page.close();
});

test('처음 영어를 드래그하면 그때 버튼 UI를 만들고 설정 읽기와 번역기 가용성 확인을 한다 (번역기는 아직 안 만듦)', async () => {
  const page = await open();
  await drag(page, 'p1');
  assert.equal(await hasUI(page), true);
  assert.deepEqual(await calls(page), { syncGet: 1, availability: 1, create: 0 });
  // 두 번째 드래그에서는 다시 준비하지 않는다.
  await drag(page, 'p2');
  assert.deepEqual(await calls(page), { syncGet: 1, availability: 1, create: 0 });
  await page.close();
});

test('모델이 있으면(available) 버튼에 마우스를 올릴 때 번역기를 미리 만들고, 클릭하면 그것을 쓴다', async () => {
  const page = await open('available');
  await drag(page, 'p1');
  await page.hover('#tfd-ui-host .button');
  await page.waitForTimeout(50);
  assert.equal((await calls(page)).create, 1, '클릭 전에 미리 만듦');
  await clickAndWait(page);
  assert.equal((await calls(page)).create, 1, '클릭 후 새로 만들지 않음');
  assert.deepEqual(await page.evaluate(() => window.__translated), ['Write the register before the first call.']);
  await page.close();
});

test('다운로드가 필요하면(downloadable) 마우스를 올려도 만들지 않고, 클릭할 때 만든다', async () => {
  const page = await open('downloadable');
  await drag(page, 'p1');
  await page.hover('#tfd-ui-host .button');
  await page.waitForTimeout(50);
  assert.equal((await calls(page)).create, 0);
  await clickAndWait(page);
  assert.equal((await calls(page)).create, 1);
  await page.close();
});

test('설정이 바뀌면 다음 번역 때 감지기를 새로 만들어 반영한다', async () => {
  const page = await open();
  await drag(page, 'p1');
  await clickAndWait(page);
  assert.deepEqual(await page.evaluate(() => window.__translated.splice(0)), ['Write the register before the first call.']);
  // 옵션 페이지에서 "항상 켤 묶음"에 임베디드를 켠 것처럼 변경 알림을 보낸다.
  await page.evaluate(() => window.__changeListeners.forEach((fn) => fn({ packsAlways: { newValue: ['embedded'] } }, 'sync')));
  await drag(page, 'p2');
  await clickAndWait(page);
  assert.deepEqual(await page.evaluate(() => window.__translated.splice(0)), ['Write the ⟦0⟧ again later.']);
  await page.close();
});
