'use strict';

/*
 * React가 관리하는 페이지에서 번역 후 React가 DOM을 바꿀 때의 동작.
 * 원본 문단은 건드리지 않고 사본에서 번역하므로(mirror.js), React가 원본을 바꿔도 오류 없이 사본이 따라가야 한다.
 * (①·②-1·②-2는 원본 노드를 떼어 내던 예전 방식에서 화면이 틀리거나 removeChild 오류가 났던 경우다)
 *
 * 실행: npm install 후 npm run test:e2e
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
  window.Translator = {
    availability: async () => 'available',
    create: async () => ({ translate: async (text) => '[ko] ' + text }),
  };
`;

let browser;

test.before(async () => {
  browser = await chromium.launch();
});

test.after(async () => {
  await browser.close();
});

async function openPage() {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.addInitScript(FAKE_TRANSLATOR);
  await page.goto('file://' + path.join(__dirname, 'react-fixture.html'));
  await page.waitForSelector('#r-text');
  for (const file of contentScripts) await page.addScriptTag({ path: path.join(ROOT, file) });
  await page.addStyleTag({ path: path.join(ROOT, 'src/content/content.css') });
  return { page, errors };
}

// 요소 안의 글자 전체를 드래그한 것처럼 선택하고 번역 버튼을 누른다.
async function translate(page, selector) {
  await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 200, clientY: 10 }));
  }, selector);
  await page.waitForTimeout(50);
  await page.locator('#tfd-ui-host .button').click();
  await page.waitForFunction(() => !document.getElementById('tfd-ui-host').shadowRoot.querySelector('.toast .message').textContent.includes('번역 중'));
}

// 사용자 눈에 보이는 글자 (숨겨진 요소 제외)
const visibleText = (page, selector) => page.$eval(selector, (el) => el.innerText.replace(/\s+/g, ' ').trim());

test('기준: 번역 직후에는 오류 없이 번역문이 보인다', async () => {
  const { page, errors } = await openPage();
  await translate(page, '#r-text');
  assert.equal(await visibleText(page, '#r-text'), '[ko] The counter is 0 right now. [ko] It updates on click.');
  assert.deepEqual(errors, []);
  await page.close();
});

test('① 글자 갱신: React가 문장 속 숫자를 바꾸면 번역문도 새 숫자로 다시 번역된다', async () => {
  const { page, errors } = await openPage();
  await translate(page, '#r-text');
  await page.click('#btn-count');
  await page.waitForTimeout(100);
  assert.deepEqual(errors, []);
  assert.equal(await visibleText(page, '#r-text'), '[ko] The counter is 1 right now. [ko] It updates on click.');
  await page.close();
});

test('②-1 텍스트 조각 제거: React가 문장 사이 글자를 지워도 오류 없이 반영된다', async () => {
  const { page, errors } = await openPage();
  await translate(page, '#r-text-remove');
  await page.click('#btn-text-remove');
  await page.waitForTimeout(100);
  assert.deepEqual(errors, []);
  assert.equal(await visibleText(page, '#r-text-remove'), '[ko] Intro sentence comes first. [ko] Final sentence ends it.');
  await page.close();
});

test('②-2 인라인 요소 제거: React가 문장 속 <em>을 지워도 오류 없이 반영된다', async () => {
  const { page, errors } = await openPage();
  await translate(page, '#r-em-remove');
  await page.click('#btn-em-remove');
  await page.waitForTimeout(100);
  assert.deepEqual(errors, []);
  assert.equal(await visibleText(page, '#r-em-remove'), '[ko] This sentence has inside it.');
  await page.close();
});

test('②-3 목록 순서 변경: <li>가 재배치되어도 오류 없이 번역이 유지된다', async () => {
  const { page, errors } = await openPage();
  await translate(page, '#r-list');
  await page.click('#btn-reorder');
  await page.waitForTimeout(100);
  assert.deepEqual(errors, []);
  assert.equal(await visibleText(page, '#r-list'), '[ko] Beta item is second.\n[ko] Alpha item is first.'.replace(/\s+/g, ' '));
  await page.close();
});

test('③ 다시 그리기: 문단이 새로 만들어지면 오류 없이 새 원문이 보이고 남은 찌꺼기가 없다', async () => {
  const { page, errors } = await openPage();
  await translate(page, '#r-remount');
  await page.click('#btn-remount');
  await page.waitForTimeout(100);
  assert.deepEqual(errors, []);
  assert.equal(await visibleText(page, '#r-remount'), 'Remounted paragraph text. It is recreated on click.');
  assert.equal(await page.$$eval('.tfd-sentence', (els) => els.length), 0);
  await page.close();
});

test('클릭 전달: 사본 속 링크를 누르면 원본 링크의 React 클릭 처리가 실행된다', async () => {
  const { page, errors } = await openPage();
  await translate(page, '#r-link');
  assert.equal(await page.$eval('#r-clicks', (el) => el.textContent), '0');
  await page.locator('#r-link.tfd-copy a').click();
  await page.waitForTimeout(100);
  assert.equal(await page.$eval('#r-clicks', (el) => el.textContent), '1');
  // React가 기본 이동을 막았으므로 주소의 해시도 그대로다.
  assert.equal(await page.evaluate(() => location.hash), '');
  assert.deepEqual(errors, []);
  await page.close();
});

test('사본은 원본 앞에 놓이고, 원본은 숨겨진다', async () => {
  const { page } = await openPage();
  await translate(page, '#r-text');
  const layout = await page.evaluate(() => {
    const [copy, original] = document.querySelectorAll('#r-text');
    return {
      order: copy.nextElementSibling === original,
      copyVisible: copy.checkVisibility(),
      originalVisible: original.checkVisibility(),
      originalUntouched: original.textContent === 'The counter is 0 right now. It updates on click.',
    };
  });
  assert.deepEqual(layout, { order: true, copyVisible: true, originalVisible: false, originalUntouched: true });
  await page.close();
});

test('입력창이 있는 문단은 사본을 만들지 않고 그 자리에서 번역한다', async () => {
  const { page, errors } = await openPage();
  await translate(page, '#r-input');
  assert.equal(await page.$$eval('#r-input', (els) => els.length), 1);
  assert.equal(await visibleText(page, '#r-input'), '[ko] Type your name here. [ko] Then press enter.');
  // 입력창은 원래 그 요소 그대로라 React 상태와 연결이 유지된다.
  await page.fill('#r-input input', 'Kim');
  assert.equal(await page.$eval('#r-input input', (el) => el.value), 'Kim');
  assert.deepEqual(errors, []);
  await page.close();
});
