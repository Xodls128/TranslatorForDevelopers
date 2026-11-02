'use strict';

/*
 * 경고 상자 라벨: 사이트가 라벨을 인라인으로 표시해도(Python 문서의 Sphinx 테마) 본문과 한 문장으로 합치지 않는다.
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

// Python 문서처럼 라벨과 본문을 모두 인라인으로 표시하는 상자, MDN처럼 본문 안에 <strong>Note:</strong>가 있는 상자
const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>boxes</title>
<style>.admonition p { display: inline; } .admonition-title::after { content: ":"; }</style></head><body>
<div class="admonition seealso" id="sphinx"><p class="admonition-title">See also</p><p>The private name mangling specifications for details.</p></div>
<div class="notecard note" id="mdn"><p><strong>Note:</strong> Using closures in this way provides benefits.</p></div>
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
  await page.route('https://docs.example.dev/boxes', (route) => route.fulfill({ contentType: 'text/html', body: HTML }));
  await page.addInitScript(FAKE);
  await page.goto('https://docs.example.dev/boxes');
  for (const file of contentScripts) await page.addScriptTag({ path: path.join(ROOT, file) });
  await page.addStyleTag({ path: path.join(ROOT, 'src/content/content.css') });
});

test.after(async () => {
  await browser.close();
});

async function translateBox(id) {
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 200, clientY: 10 }));
  }, id);
  await page.waitForTimeout(60);
  await page.locator('#tfd-ui-host .button').click();
  await page.waitForFunction(() => /번역했습니다/.test(document.getElementById('tfd-ui-host').shadowRoot.querySelector('.toast .message').textContent));
  return page.evaluate(() => window.__translated.splice(0));
}

test('인라인으로 표시된 상자 라벨(.admonition-title)은 본문과 따로 번역한다', async () => {
  assert.deepEqual(await translateBox('sphinx'), ['See also', 'The private name mangling specifications for details.']);
});

test('본문 안의 <strong>Note:</strong>는 지금처럼 본문과 한 문장', async () => {
  // closures는 보존 용어라 토큰이 된다.
  assert.deepEqual(await translateBox('mdn'), ['Note: Using ⟦0⟧ in this way provides benefits.']);
});
