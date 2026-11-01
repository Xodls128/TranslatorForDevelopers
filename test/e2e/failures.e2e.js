'use strict';

/*
 * 번역이 멈추거나 실패할 때: 상태 초기화, 안내 카드, 취소, 번역 중 다른 동작.
 * 가짜 번역기를 window.__fake 설정으로 멈추게/느리게/거부하게 만든다. 제한 시간은 테스트용으로 짧게 줄인다.
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

// create: 'ok' | 'stall'(영원히 대기) | 'slow'(진행률을 조금씩 보내다 완료) | 'not-allowed' | 'none'(API 없음)
// hang: 이 글자가 든 문장은 번역이 끝나지 않음, slow: 이 글자가 든 문장은 slowMs 뒤에 끝남,
// drop: 이 글자가 든 문장은 토큰을 빼고 돌려줌 (용어 보호 실패)
const FAKE_TRANSLATOR = `
  window.__fake = { create: 'ok', hang: null, slow: null, slowMs: 500, drop: null };
  window.Translator = {
    availability: async () => 'downloadable',
    create: (options) => {
      const mode = window.__fake.create;
      if (mode === 'stall') return new Promise(() => {});
      if (mode === 'not-allowed') return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
      const translator = {
        translate: (text) => {
          if (window.__fake.hang && text.includes(window.__fake.hang)) return new Promise(() => {});
          if (window.__fake.drop && text.includes(window.__fake.drop)) return Promise.resolve('[ko] ' + text.replace(/⟦\\d+⟧/g, ''));
          if (window.__fake.slow && text.includes(window.__fake.slow)) {
            return new Promise((resolve) => setTimeout(() => resolve('[ko] ' + text), window.__fake.slowMs));
          }
          return Promise.resolve('[ko] ' + text);
        },
      };
      if (mode !== 'slow') return Promise.resolve(translator);
      const monitor = new EventTarget();
      options.monitor(monitor);
      return new Promise((resolve) => {
        let step = 0;
        const timer = setInterval(() => {
          step++;
          monitor.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: step / 6 }));
          if (step === 6) { clearInterval(timer); resolve(translator); }
        }, 150);
      });
    },
  };
`;

let browser;

test.before(async () => {
  browser = await chromium.launch();
});

test.after(async () => {
  await browser.close();
});

async function openPage({ stallMs = 300, sentenceMs = 300, noApi = false } = {}) {
  const page = await browser.newPage();
  await page.addInitScript(FAKE_TRANSLATOR);
  if (noApi) await page.addInitScript('delete window.Translator;');
  await page.goto('file://' + path.join(__dirname, 'fixture.html'));
  for (const file of contentScripts) await page.addScriptTag({ path: path.join(ROOT, file) });
  await page.addStyleTag({ path: path.join(ROOT, 'src/content/content.css') });
  await page.evaluate(([stall, sentence]) => {
    TFD.TRANSLATOR_TIMEOUTS.downloadStallMs = stall;
    TFD.TRANSLATOR_TIMEOUTS.sentenceMs = sentence;
  }, [stallMs, sentenceMs]);
  return page;
}

async function select(page, selector, startText, endText) {
  await page.evaluate(({ selector, startText, endText }) => {
    const rootEl = document.querySelector(selector);
    rootEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }));
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
    rootEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 150, clientY: 100 }));
  }, { selector, startText, endText });
  await page.waitForTimeout(50);
}

const shadow = (page, fn, arg) => page.evaluate(([src, a]) => {
  const root = document.getElementById('tfd-ui-host').shadowRoot;
  return new Function('root', 'arg', src)(root, a);
}, [fn, arg]);

const buttonVisible = (page) => shadow(page, "return !root.querySelector('.button').hidden;");
const toastText = (page) => shadow(page, "const t = root.querySelector('.toast'); return t.hidden ? null : t.querySelector('.message').textContent;");
const card = (page) => shadow(page, `
  const c = root.querySelector('.card');
  if (c.hidden) return null;
  return {
    title: c.querySelector('.title').textContent,
    body: c.querySelector('.body') ? c.querySelector('.body').textContent : '',
    copy: c.querySelector('code') ? c.querySelector('code').textContent : null,
    retry: !!c.querySelector('.retry'),
    detail: c.querySelector('details pre') ? c.querySelector('details pre').textContent : null,
  };
`);
const waitForCard = (page) => page.waitForFunction(() => !document.getElementById('tfd-ui-host').shadowRoot.querySelector('.card').hidden);
const states = (page, selector) => page.$$eval(`${selector} .tfd-sentence`, (els) => els.map((el) => el.dataset.tfdState));

test('다운로드가 멈추면 안내 카드를 띄우고, 다시 드래그하면 번역 버튼이 뜬다', async () => {
  const page = await openPage();
  await page.evaluate(() => (window.__fake.create = 'stall'));
  await select(page, '#p1', 'can call', 'It returns');
  await page.locator('#tfd-ui-host .button').click();
  await waitForCard(page);

  const info = await card(page);
  assert.equal(info.title, '번역 모델 다운로드가 진행되지 않았습니다');
  assert.match(info.body, /^\d+초 동안 진행이 없어 중단했습니다\.$/);
  assert.equal(info.copy, 'chrome://on-device-translation-internals');
  assert.equal(info.retry, true);
  assert.equal(await toastText(page), null);

  // 상태가 초기화되어 다시 번역할 수 있다. 이번에는 다운로드가 정상이라고 가정하고 "다시 시도".
  await select(page, '#p1', 'can call', 'It returns');
  assert.equal(await buttonVisible(page), true);
  await page.evaluate(() => (window.__fake.create = 'ok'));
  await page.locator('#tfd-ui-host .retry').click();
  await page.waitForFunction(() => document.querySelectorAll('#p1 .tfd-sentence').length === 2);
  await page.close();
});

test('오프라인에서 다운로드가 멈추면 오프라인 안내', async () => {
  const page = await openPage();
  await page.evaluate(() => {
    window.__fake.create = 'stall';
    Object.defineProperty(navigator, 'onLine', { get: () => false });
  });
  await select(page, '#p1', 'can call', 'It returns');
  await page.locator('#tfd-ui-host .button').click();
  await waitForCard(page);
  assert.equal((await card(page)).title, '인터넷에 연결되어 있지 않아 번역 모델을 받지 못했습니다');
  await page.close();
});

test('다운로드가 느려도 진행률이 계속 오면 끊지 않는다', async () => {
  // 진행률 간격 150ms × 6번 = 0.9초 > 제한 0.3초. 전체 시간이 아니라 "진행 없음"으로 판단하므로 끝까지 기다린다.
  const page = await openPage();
  await page.evaluate(() => (window.__fake.create = 'slow'));
  await select(page, '#p1', 'can call', 'It returns');
  await page.locator('#tfd-ui-host .button').click();
  await page.waitForFunction(() => document.querySelectorAll('#p1 .tfd-sentence').length === 2);
  assert.equal(await card(page), null);
  await page.close();
});

test('문장 번역이 멈추면 끝난 문장까지 반영하고 안내, 다시 시도로 나머지를 이어서 번역', async () => {
  const page = await openPage();
  await page.evaluate(() => (window.__fake.hang = 'It returns'));
  await select(page, '#p1', 'can call', 'It returns');
  await page.locator('#tfd-ui-host .button').click();
  await waitForCard(page);

  const info = await card(page);
  assert.equal(info.title, '일부 문장 번역이 응답하지 않아 중단했습니다');
  assert.equal(info.body, '1문장 완료, 1문장 실패.');
  assert.deepEqual(await states(page, '#p1'), ['translated']);

  await page.evaluate(() => (window.__fake.hang = null));
  await page.locator('#tfd-ui-host .retry').click();
  await page.waitForFunction(() => document.querySelectorAll('#p1 .tfd-sentence').length === 2);
  await page.close();
});

test('취소 버튼: 즉시 멈추고 카드 없이 알림, 다음 번역은 정상', async () => {
  const page = await openPage({ stallMs: 60000 });
  await page.evaluate(() => (window.__fake.create = 'stall'));
  await select(page, '#p1', 'can call', 'It returns');
  await page.locator('#tfd-ui-host .button').click();
  await page.locator('#tfd-ui-host .cancel').click();
  await page.waitForFunction(() => document.getElementById('tfd-ui-host').shadowRoot.querySelector('.message').textContent.includes('취소'));
  assert.equal(await toastText(page), '번역을 취소했습니다.');
  assert.equal(await card(page), null);

  await page.evaluate(() => (window.__fake.create = 'ok'));
  await select(page, '#p1', 'can call', 'It returns');
  await page.locator('#tfd-ui-host .button').click();
  await page.waitForFunction(() => document.querySelectorAll('#p1 .tfd-sentence').length === 2);
  await page.close();
});

test('번역 중에도 이미 번역된 문장의 원문 전환은 되고, 새 번역 버튼은 뜨지 않는다', async () => {
  const page = await openPage({ sentenceMs: 60000 });
  await select(page, '#p1', 'can call', 'at any time');
  await page.locator('#tfd-ui-host .button').click();
  await page.waitForFunction(() => document.querySelectorAll('#p1 .tfd-sentence').length === 1);

  // 다른 문단 번역을 멈춘 상태로 진행 중으로 만든다.
  await page.evaluate(() => (window.__fake.hang = 'First item'));
  await select(page, '#li1', 'First', 'Set');
  await page.locator('#tfd-ui-host .button').click();
  await page.waitForTimeout(100);

  await select(page, '#p1', '[ko]', 'can call');
  assert.deepEqual(await states(page, '#p1'), ['original']);
  await select(page, '#p1', 'It returns', 'object');
  assert.equal(await buttonVisible(page), false);

  await page.locator('#tfd-ui-host .cancel').click();
  await page.waitForFunction(() => document.getElementById('tfd-ui-host').shadowRoot.querySelector('.message').textContent.includes('취소'));
  assert.equal(await toastText(page), '번역을 취소했습니다. 0문장은 번역을 마쳤습니다.');
  await page.close();
});

test('번역기 생성이 거부되면 허용 안내와 자세한 오류', async () => {
  const page = await openPage();
  await page.evaluate(() => (window.__fake.create = 'not-allowed'));
  await select(page, '#p1', 'can call', 'It returns');
  await page.locator('#tfd-ui-host .button').click();
  await waitForCard(page);
  const info = await card(page);
  assert.equal(info.title, '번역기 사용이 허용되지 않았습니다');
  assert.equal(info.detail, 'NotAllowedError: blocked');
  await page.close();
});

test('Translator API가 없으면 업데이트 안내, 다시 시도 버튼 없음', async () => {
  const page = await openPage({ noApi: true });
  await select(page, '#p1', 'can call', 'It returns');
  await page.locator('#tfd-ui-host .button').click();
  await waitForCard(page);
  const info = await card(page);
  assert.equal(info.title, '이 브라우저는 내장 번역을 지원하지 않습니다');
  assert.equal(info.copy, 'chrome://settings/help');
  assert.equal(info.retry, false);
  await page.close();
});

test('하나씩 표시: 끝난 문장은 바로 번역문, 남은 문장은 "번역 중"으로 보인다', async () => {
  const page = await openPage({ sentenceMs: 5000 });
  await page.evaluate(() => (window.__fake.slow = 'It returns'));
  await select(page, '#p1', 'can call', 'It returns');
  await page.locator('#tfd-ui-host .button').click();
  await page.waitForTimeout(150);
  assert.deepEqual(await states(page, '#p1'), ['translated', 'pending']);
  // 번역 중인 문장도 원문 글자가 그대로 보인다.
  assert.equal(await page.$eval('#p1 .tfd-sentence[data-tfd-state="pending"]', (el) => el.textContent), 'It returns a Promise object.');
  await page.waitForTimeout(600);
  assert.deepEqual(await states(page, '#p1'), ['translated', 'translated']);
  await page.close();
});

test('하나씩 표시: 도중에 취소하면 끝난 문장은 남고, 대기 중이던 문장은 원래대로 돌아온다', async () => {
  const page = await openPage({ sentenceMs: 60000 });
  const before = await page.$eval('#p1', (el) => el.textContent);
  await page.evaluate(() => (window.__fake.hang = 'It returns'));
  await select(page, '#p1', 'can call', 'It returns');
  await page.locator('#tfd-ui-host .button').click();
  await page.waitForTimeout(100);
  await page.locator('#tfd-ui-host .cancel').click();
  await page.waitForTimeout(100);
  assert.deepEqual(await states(page, '#p1'), ['translated']);
  assert.equal(await page.$$eval('[data-tfd-state="pending"]', (els) => els.length), 0);
  // 되돌린 문장은 원래 글자 그대로 (번역된 첫 문장을 원문으로 돌리면 전체가 원래와 같다)
  await select(page, '#p1', '[ko]', 'can call');
  assert.equal(await page.$eval('#p1', (el) => el.textContent), before);
  await page.close();
});

test('하나씩 표시: 토큰이 깨진 문장만 원래대로 돌아오고 안내 카드가 뜬다', async () => {
  const page = await openPage();
  await page.evaluate(() => (window.__fake.drop = 'It returns'));
  await select(page, '#p1', 'can call', 'It returns');
  await page.locator('#tfd-ui-host .button').click();
  await waitForCard(page);
  assert.equal((await card(page)).title, '1문장은 개발 용어 보호 처리에 실패해 원문으로 두었습니다');
  assert.deepEqual(await states(page, '#p1'), ['translated']);
  assert.equal(await page.$$eval('[data-tfd-state="pending"]', (els) => els.length), 0);
  await page.close();
});
