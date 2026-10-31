'use strict';

/*
 * React가 관리하는 페이지에서 번역 후 React가 DOM을 바꿀 때의 동작.
 * 각 테스트는 "앞으로 통과해야 할 동작"이다. 지금 방식(원문 노드를 떼어 내는 방식)에서 실패하는 테스트는
 * todo로 표시해 두었다. 문단 사본 방식으로 바꾼 뒤 todo를 지운다.
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

const TODO = '문단 사본 방식으로 바꾼 뒤 통과 예정';

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

test('① 글자 갱신: React가 문장 속 숫자를 바꾸면 번역문도 새 숫자로 다시 번역된다', { todo: TODO }, async () => {
  const { page, errors } = await openPage();
  await translate(page, '#r-text');
  await page.click('#btn-count');
  await page.waitForTimeout(100);
  assert.deepEqual(errors, []);
  assert.equal(await visibleText(page, '#r-text'), '[ko] The counter is 1 right now. [ko] It updates on click.');
  await page.close();
});

test('②-1 텍스트 조각 제거: React가 문장 사이 글자를 지워도 오류 없이 반영된다', { todo: TODO }, async () => {
  const { page, errors } = await openPage();
  await translate(page, '#r-text-remove');
  await page.click('#btn-text-remove');
  await page.waitForTimeout(100);
  assert.deepEqual(errors, []);
  assert.equal(await visibleText(page, '#r-text-remove'), '[ko] Intro sentence comes first. [ko] Final sentence ends it.');
  await page.close();
});

test('②-2 인라인 요소 제거: React가 문장 속 <em>을 지워도 오류 없이 반영된다', { todo: TODO }, async () => {
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
