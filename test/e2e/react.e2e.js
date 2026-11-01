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
    // window.__slowMs가 있으면 그만큼 늦게 끝난다. (번역 도중 페이지가 바뀌는 상황을 만들 때)
    create: async () => ({
      translate: (text) => new Promise((resolve) => setTimeout(() => resolve('[ko] ' + text), window.__slowMs || 0)),
    }),
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

test('입력창 문단: 사본에서는 입력이 막히고, 누르면 원본 문단에서 입력한 뒤 번역본으로 돌아온다', async () => {
  const { page, errors } = await openPage();
  await translate(page, '#r-input');
  assert.equal(await visibleText(page, '#r-input.tfd-copy'), '[ko] Type your name here. [ko] Then press enter.');

  // 사본 입력창을 누르면 그 문단만 원본이 보이고, 원본 입력창에 커서가 간다.
  await page.locator('#r-input.tfd-copy input').click();
  const editing = await page.evaluate(() => {
    const [copy, original] = document.querySelectorAll('#r-input');
    return {
      copyVisible: copy.checkVisibility(),
      originalVisible: original.checkVisibility(),
      focused: document.activeElement === original.querySelector('input'),
    };
  });
  assert.deepEqual(editing, { copyVisible: false, originalVisible: true, focused: true });

  // 원본 입력창에 입력하면 React 상태가 바뀐다.
  await page.keyboard.type('Kim');
  assert.equal(await page.$eval('#r-name', (el) => el.textContent), 'Kim');

  // 문단 밖을 누르면 번역본으로 돌아오고, 사본 입력창에도 입력한 값이 보인다.
  await page.mouse.click(5, 5);
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => {
    const [copy, original] = document.querySelectorAll('#r-input');
    return {
      copyVisible: copy.checkVisibility(),
      originalVisible: original.checkVisibility(),
      copyValue: copy.querySelector('input').value,
    };
  });
  assert.deepEqual(after, { copyVisible: true, originalVisible: false, copyValue: 'Kim' });
  assert.equal(await visibleText(page, '#r-input.tfd-copy'), '[ko] Type your name here. [ko] Then press enter.');
  assert.deepEqual(errors, []);
  await page.close();
});

test('캔버스가 있는 문단은 번역하지 않고 알린다', async () => {
  const { page } = await openPage();
  await translate(page, '#r-canvas');
  assert.equal(await page.$$eval('#r-canvas', (els) => els.length), 1);
  assert.equal(await page.$$eval('.tfd-sentence', (els) => els.length), 0);
  const toast = await page.evaluate(() => document.getElementById('tfd-ui-host').shadowRoot.querySelector('.toast .message').textContent);
  assert.equal(toast, '2문장은 동영상·그림·삽입된 페이지가 있는 문단이라 번역하지 않았습니다.');
  await page.close();
});

test('원본 보기: Shift를 0.3초 이상 누르고 있는 동안 원본이 보이고, 떼면 번역본으로 돌아온다', async () => {
  const { page } = await openPage();
  await translate(page, '#r-text');
  const visibility = () => page.evaluate(() => [...document.querySelectorAll('#r-text')].map((el) => el.checkVisibility()));
  assert.deepEqual(await visibility(), [true, false]);

  await page.keyboard.down('Shift');
  // 누르자마자는 아직 번역본 (대문자 입력과 겹치지 않도록 잠깐 기다린다)
  assert.deepEqual(await visibility(), [true, false]);
  await page.waitForTimeout(400);
  assert.deepEqual(await visibility(), [false, true]);
  await page.keyboard.up('Shift');
  assert.deepEqual(await visibility(), [true, false]);
  await page.close();
});

test('원본 보기: 대문자 입력·Shift+클릭·입력창에서는 켜지지 않거나 바로 꺼진다', async () => {
  const { page } = await openPage();
  await translate(page, '#r-text');
  const visibility = () => page.evaluate(() => [...document.querySelectorAll('#r-text')].map((el) => el.checkVisibility()));

  // 대문자 입력처럼 Shift와 다른 키를 함께 누르면 켜지지 않는다.
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
  assert.deepEqual(await visibility(), [true, false]);
  await page.keyboard.up('Shift');

  // 켜진 상태에서 마우스를 누르면(Shift+클릭) 바로 번역본으로 돌아온다.
  await page.keyboard.down('Shift');
  await page.waitForTimeout(400);
  assert.deepEqual(await visibility(), [false, true]);
  await page.mouse.down();
  assert.deepEqual(await visibility(), [true, false]);
  await page.mouse.up();
  await page.keyboard.up('Shift');

  // 입력창에 커서가 있으면 켜지지 않는다.
  await page.focus('#r-input input');
  await page.keyboard.down('Shift');
  await page.waitForTimeout(400);
  assert.deepEqual(await visibility(), [true, false]);
  await page.keyboard.up('Shift');
  await page.close();
});

test('숨김 보강: 사이트 CSS가 display를 강제해도 원본은 숨겨진다', async () => {
  const { page } = await openPage();
  await page.addStyleTag({ content: '#r-text { display: block !important; }' });
  await translate(page, '#r-text');
  const visibility = await page.evaluate(() => [...document.querySelectorAll('#r-text')].map((el) => el.checkVisibility()));
  assert.deepEqual(visibility, [true, false]);
  await page.close();
});

test('번역 도중 페이지가 문단을 바꾸면 새 사본에서 다시 번역하고, 알림도 그에 맞게 나온다', async () => {
  const { page, errors } = await openPage();
  await page.evaluate(() => (window.__slowMs = 300));
  // 번역 버튼을 누르고, 첫 문장을 번역하는 동안(0.3초) React가 문단을 바꾼다.
  await page.evaluate(() => {
    const el = document.querySelector('#r-text');
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 200, clientY: 10 }));
  });
  await page.waitForTimeout(50);
  await page.locator('#tfd-ui-host .button').click();
  await page.waitForTimeout(100);
  await page.click('#btn-count');
  await page.waitForTimeout(1200);
  assert.equal(await visibleText(page, '#r-text'), '[ko] The counter is 1 right now. [ko] It updates on click.');
  const toast = await page.evaluate(() => document.getElementById('tfd-ui-host').shadowRoot.querySelector('.toast .message').textContent);
  assert.equal(toast, '번역하는 동안 페이지 내용이 바뀌어, 바뀐 문단을 새로 번역했습니다.');
  assert.deepEqual(errors, []);
  await page.close();
});
