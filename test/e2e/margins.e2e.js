'use strict';

/*
 * 사본 여백: 원본에 적용되던 위아래 여백을 따라가고, 창 크기가 바뀌면 다시 맞춘다.
 * - 위치 규칙(:last-child, p + p)이 사본에 잘못 적용되지 않는지
 * - 화면 너비에 따라 여백이 바뀌는 사이트에서 창 크기를 바꾸면 사본 여백도 바뀌는지
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

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>margins</title>
<style>
  p { margin: 24px 0; }
  p + p { margin-top: 40px; }
  p:last-child { margin-bottom: 0; }
  @media (max-width: 700px) { p { margin: 8px 0; } p + p { margin-top: 12px; } p:last-child { margin-bottom: 0; } }
</style></head><body>
<div id="box"><p id="first">First paragraph in the box.</p><p id="last">Last paragraph in the box.</p></div>
</body></html>`;

const FAKE = `
  window.Translator = {
    availability: async () => 'available',
    create: async () => ({ translate: async (t) => '[ko] ' + t }),
  };
`;

let browser;

test.before(async () => {
  browser = await launchBrowser();
});

test.after(async () => {
  await browser.close();
});

async function translate(page, id) {
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
}

// 보이는 쪽(사본) 문단의 실제 위아래 여백
const margins = (page, id) => page.evaluate((id) => {
  const el = [...document.querySelectorAll(`#${id}`)].find((e) => getComputedStyle(e).display !== 'none');
  const cs = getComputedStyle(el);
  return [cs.marginTop, cs.marginBottom];
}, id);

test('사본은 원본 위치에 맞는 여백을 쓰고(:last-child, p + p), 창 크기가 바뀌면 다시 맞춘다', async () => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.route('https://docs.example.dev/margins', (route) => route.fulfill({ contentType: 'text/html', body: HTML }));
  await page.addInitScript(FAKE);
  await page.goto('https://docs.example.dev/margins');
  for (const file of contentScripts) await page.addScriptTag({ path: path.join(ROOT, file) });
  await page.addStyleTag({ path: path.join(ROOT, 'src/content/content.css') });

  assert.deepEqual(await margins(page, 'last'), ['40px', '0px'], '원본(번역 전)');
  await translate(page, 'last');
  assert.deepEqual(await margins(page, 'last'), ['40px', '0px'], '사본도 원본처럼 p + p 위 여백, :last-child 아래 여백 0');
  await translate(page, 'first');
  assert.deepEqual(await margins(page, 'first'), ['24px', '24px'], '첫 문단 사본');

  // 좁은 창: 사이트 규칙이 8px/12px로 바뀐다. 크기 조절이 멈추고 0.2초 뒤에 다시 맞춘다.
  await page.setViewportSize({ width: 600, height: 800 });
  await page.waitForTimeout(400);
  assert.deepEqual(await margins(page, 'first'), ['8px', '8px']);
  assert.deepEqual(await margins(page, 'last'), ['12px', '0px']);

  // 다시 넓게
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForTimeout(400);
  assert.deepEqual(await margins(page, 'first'), ['24px', '24px']);
  assert.deepEqual(await margins(page, 'last'), ['40px', '0px']);
  // 사본은 원본 바로 앞에 그대로 있다.
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('#box > p')].map((p) => p.className || 'orig').join(',')), 'tfd-copy,orig,tfd-copy,orig');
  await page.close();
});
