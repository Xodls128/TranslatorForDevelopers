'use strict';

/*
 * 공식 한국어판 안내: 페이지가 밝힌 한국어판 링크가 있으면 첫 번역 결과와 함께 알려 준다.
 * (Playwright가 문서 주소 요청을 가로채 테스트 HTML을 돌려주므로 네트워크는 쓰지 않는다)
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

const page = (head = '', lang = 'en') => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>doc</title>${head}</head><body>
  <p id="p1">First paragraph to translate.</p>
  <p id="p2">Second paragraph to translate.</p>
</body></html>`;

const FAKE = `
  const area = (data) => ({
    async get(keys) { return keys && typeof keys === 'object' && !Array.isArray(keys) ? { ...keys, ...data } : { ...data }; },
    async set(items) { Object.assign(data, items); },
    async remove() {}, async getBytesInUse() { return 0; },
  });
  window.chrome = { storage: { local: area({}), sync: area(window.__sync || {}), onChanged: { addListener() {} } } };
  window.Translator = {
    availability: async () => 'available',
    create: async () => ({ translate: async (text) => '[ko] ' + text }),
  };
`;

let browser;

test.before(async () => {
  browser = await launchBrowser();
});

test.after(async () => {
  await browser.close();
});

async function openAt(url, html, sync) {
  const p = await browser.newPage();
  await p.route(url, (route) => route.fulfill({ contentType: 'text/html', body: html }));
  if (sync) await p.addInitScript((s) => (window.__sync = s), sync);
  await p.addInitScript(FAKE);
  await p.goto(url);
  for (const file of contentScripts) await p.addScriptTag({ path: path.join(ROOT, file) });
  await p.addStyleTag({ path: path.join(ROOT, 'src/content/content.css') });
  await p.waitForTimeout(50);
  return p;
}

// 문단 하나를 번역하고, 결과 알림의 글자와 링크를 돌려준다.
async function translate(p, id) {
  await p.evaluate((id) => {
    const el = document.getElementById(id);
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 200, clientY: 10 }));
  }, id);
  await p.waitForTimeout(50);
  await p.locator('#tfd-ui-host .button').click();
  await p.waitForFunction(() => document.getElementById('tfd-ui-host').shadowRoot.querySelector('.toast .message').textContent.includes('번역했습니다'));
  return p.evaluate(() => {
    const root = document.getElementById('tfd-ui-host').shadowRoot;
    const link = root.querySelector('.toast .link');
    return { message: root.querySelector('.toast .message').textContent, link: link.hidden ? null : { text: link.textContent, href: link.href, target: link.target } };
  });
}

const KO_LINK = '<link rel="alternate" hreflang="en" href="https://docs.example.dev/guide"><link rel="alternate" hreflang="ko" href="/ko/guide">';

test('한국어판 링크가 있으면 첫 번역 결과에 링크를 붙이고, 같은 페이지 두 번째 번역에는 붙이지 않는다', async () => {
  const p = await openAt('https://docs.example.dev/guide', page(KO_LINK));
  const first = await translate(p, 'p1');
  assert.match(first.message, /이 문서는 공식 한국어판이 있습니다/);
  assert.deepEqual(first.link, { text: '한국어판 열기', href: 'https://docs.example.dev/ko/guide', target: '_blank' });

  const second = await translate(p, 'p2');
  assert.doesNotMatch(second.message, /한국어판/);
  assert.equal(second.link, null);
  await p.close();
});

test('언어 메뉴의 <a hreflang="ko-KR">도 인정한다', async () => {
  const p = await openAt('https://docs.example.dev/a', page().replace('<body>', '<body><nav><a hreflang="ko-KR" href="https://ko.example.dev/a">한국어</a></nav>'));
  assert.equal((await translate(p, 'p1')).link.href, 'https://ko.example.dev/a');
  await p.close();
});

test('한국어판 링크가 없거나, 이미 한국어 페이지이거나, 링크가 자기 자신이면 안내하지 않는다', async () => {
  for (const [url, html] of [
    ['https://docs.example.dev/none', page()],
    ['https://docs.example.dev/ko/guide', page(KO_LINK, 'ko')],
    ['https://docs.example.dev/self', page('<link rel="alternate" hreflang="ko" href="https://docs.example.dev/self#top">')],
  ]) {
    const p = await openAt(url, html);
    const result = await translate(p, 'p1');
    assert.equal(result.link, null, url);
    assert.doesNotMatch(result.message, /한국어판/, url);
    await p.close();
  }
});

test('옵션에서 끄면 안내하지 않는다', async () => {
  const p = await openAt('https://docs.example.dev/guide', page(KO_LINK), { koreanEdition: false });
  assert.equal((await translate(p, 'p1')).link, null);
  await p.close();
});
