'use strict';

/*
 * content script를 실제 Chromium 페이지에 넣어 드래그 → 번역 → 원문/번역문 전환 흐름을 확인한다.
 * 헤드리스 Chromium에는 Translator API(언어팩)가 없으므로 토큰을 그대로 두는 가짜 번역기를 넣는다.
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

const FAKE_TRANSLATOR = `
  window.__translated = [];
  window.__opened = [];
  window.open = (url) => { window.__opened.push(url); return null; };
  window.Translator = {
    availability: async () => 'available',
    create: async () => ({
      translate: async (text) => {
        window.__translated.push(text);
        // 링크 테스트용: 정해 둔 문장은 정해 둔 한국어로 번역한다.
        const dict = {
          'See ⟦0⟧ for details.': '자세한 내용은 ⟦0⟧을 참조하세요.',
          // 링크 글자 안의 개발 용어(closures)도 보호되어 번역기에는 토큰으로 들어간다.
          'the ⟦0⟧ guide': '⟦0⟧ 가이드.',
          'very long link text that spans more than six words here': '여섯 단어보다 긴 아주 긴 링크 글자',
          '⟦0⟧ docs': '⟦0⟧ docs',
        };
        if (dict[text]) return dict[text];
        // "A ⟦0⟧ ..." → "⟦0⟧는 ..." 처럼 조사를 붙여 조사 병기 처리를 확인한다.
        return '[ko] ' + text.replace(/^A (⟦\\d+⟧)/, '$1는');
      },
    }),
  };
`;

let browser;
let page;

/**
 * 요소 안 텍스트에서 startText 시작 ~ endText 끝까지 선택하고, 마우스로 드래그를 끝낸 것처럼 이벤트를 보낸다.
 * @param {{from?: number[], to?: number[]}} [pointer] mousedown/mouseup 좌표. 기본값은 50px 드래그
 */
async function select(selector, startText, endText, pointer = {}) {
  const from = pointer.from || [100, 100];
  const to = pointer.to || [150, 100];
  await page.evaluate(({ selector, startText, endText, from, to }) => {
    const rootEl = document.querySelector(selector);
    rootEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: from[0], clientY: from[1] }));
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
    rootEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: to[0], clientY: to[1] }));
  }, { selector, startText, endText, from, to });
  await page.waitForTimeout(50);
}

async function buttonBox() {
  return page.evaluate(() => {
    const button = document.getElementById('tfd-ui-host').shadowRoot.querySelector('.button');
    if (button.hidden) return null;
    const { left, top } = button.getBoundingClientRect();
    return { left, top };
  });
}

async function clickTranslate() {
  await page.locator('#tfd-ui-host .button').click();
  await page.waitForFunction(() => !document.getElementById('tfd-ui-host').shadowRoot.querySelector('.toast').textContent.includes('번역 중'));
}

const states = (selector) => page.$$eval(`${selector} .tfd-sentence`, (els) => els.map((el) => el.dataset.tfdState));
const texts = (selector) => page.$$eval(`${selector} .tfd-sentence`, (els) => els.map((el) => el.textContent));

test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.addInitScript(FAKE_TRANSLATOR);
  await page.goto('file://' + path.join(__dirname, 'fixture.html'));
  for (const file of contentScripts) await page.addScriptTag({ path: path.join(ROOT, file) });
  await page.addStyleTag({ path: path.join(ROOT, 'src/content/content.css') });
});

test.after(async () => {
  await browser.close();
});

test('영어 드래그 → 마우스 옆 번역 버튼 → 걸친 문장만 번역, 코드/링크/용어 보존', async () => {
  // 첫 문장 중간 ~ 둘째 문장 중간까지 드래그 (<code>를 가로지름). 아래→위 드래그처럼 끝점을 위쪽에 둔다.
  await select('#p1', 'can call', 'It returns', { from: [300, 200], to: [220, 120] });
  const box = await buttonBox();
  assert.ok(box, '번역 버튼이 보여야 한다');
  assert.ok(Math.abs(box.left - 230) <= 2 && Math.abs(box.top - 130) <= 2, `버튼이 마우스 옆에 떠야 한다: ${JSON.stringify(box)}`);
  await clickTranslate();

  assert.deepEqual(await texts('#p1'), [
    '[ko] closure은(는) can call fetch() at any time.',
    '[ko] It returns a Promise object.',
  ]);
  assert.deepEqual(await states('#p1'), ['translated', 'translated']);
  // <code>와 <a>는 원래 요소 그대로(복제본) 들어간다.
  assert.equal(await page.$eval('#p1 .tfd-sentence code', (el) => el.textContent), 'fetch()');
  assert.equal(await page.$eval('#p1 .tfd-sentence a', (el) => el.getAttribute('href')), '#promise');
  // 번역기에는 토큰이 들어간 문장이 전달된다.
  assert.deepEqual(await page.evaluate(() => window.__translated), ['A ⟦0⟧ can call ⟦1⟧ at any time.', 'It returns a ⟦0⟧ object.']);
});

test('제자리 클릭(더블클릭 단어 선택 포함)으로는 원문으로 바뀌지 않는다', async () => {
  await select('#p1', 'It returns', 'returns', { from: [200, 100], to: [201, 100] });
  assert.deepEqual(await states('#p1'), ['translated', 'translated']);
  assert.equal(await buttonBox(), null);
});

test('번역문 드래그 → 원문, 원문 클릭 → 다시 번역문', async () => {
  await select('#p1', '[ko] It', 'returns');
  assert.deepEqual(await states('#p1'), ['translated', 'original']);
  assert.equal((await texts('#p1'))[1], 'It returns a Promise object.');
  assert.equal(await buttonBox(), null);

  // 원문 상태 문장을 클릭하면 번역문으로 돌아온다. (번역기를 다시 부르지 않는다)
  const calls = await page.evaluate(() => window.__translated.length);
  await page.locator('#p1 .tfd-sentence[data-tfd-state="original"]').click({ position: { x: 5, y: 5 } });
  assert.deepEqual(await states('#p1'), ['translated', 'translated']);
  assert.equal((await texts('#p1'))[1], '[ko] It returns a Promise object.');
  assert.equal(await page.evaluate(() => window.__translated.length), calls);
});

test('원문 상태 문장을 다시 드래그해서 번역 버튼을 누르면 보관된 번역문으로 돌아온다', async () => {
  await select('#p1', '[ko] It', 'returns');
  assert.deepEqual(await states('#p1'), ['translated', 'original']);
  await select('#p1', 'It returns', 'object');
  assert.ok(await buttonBox());
  await clickTranslate();
  assert.deepEqual(await states('#p1'), ['translated', 'translated']);
});

test('여러 줄과 <strong>에 걸친 문장도 한 문장으로 번역하고, 원문으로 돌리면 원래 DOM 그대로', async () => {
  await select('#p1', 'spans', 'bold');
  await clickTranslate();
  assert.equal((await texts('#p1'))[2], '[ko] This sentence spans lines and has bold text inside.');

  await select('#p1', '[ko] This', 'spans');
  const restored = await page.$eval('#p1 .tfd-sentence[data-tfd-state="original"]', (el) => el.innerHTML);
  assert.match(restored, /^This sentence spans\s+lines and has <strong>bold text<\/strong> inside\.$/);
});

test('inline-block 배지는 통째로 보존', async () => {
  await select('#p1', 'Final', 'here');
  await clickTranslate();
  assert.equal(await page.$eval('#p1 .tfd-sentence .badge', (el) => el.textContent), 'new');
});

test('제목형 문장은 다의어 용어도 보존, 용어 클릭 시 검색 페이지 열기', async () => {
  await select('#title', 'Structures', 'Unions');
  await clickTranslate();
  const terms = await page.$$eval('#title .tfd-term', (els) => els.map((el) => el.dataset.term));
  assert.deepEqual(terms, ['structure', 'union']);

  await page.locator('#title .tfd-term').nth(1).click();
  const opened = await page.evaluate(() => window.__opened);
  assert.deepEqual(opened, ['https://www.google.com/search?q=' + encodeURIComponent('프로그래밍언어 union')]);
  // 용어 클릭은 문장 전환을 일으키지 않는다.
  assert.deepEqual(await states('#title'), ['translated']);
});

test('약어 e.g. 에서 문장을 끊지 않는다', async () => {
  await select('#li1', 'First', 'Set');
  await clickTranslate();
  assert.deepEqual(await texts('#li1'), ['[ko] First item, e.g. Map or Set.']);
});

test('강조 A: 문장 글자 전체가 강조면 마침표가 밖에 있어도 번역문 전체를 강조', async () => {
  await select('#em-outside', 'Never', 'slow');
  await clickTranslate();
  assert.deepEqual(await texts('#em-outside'), ['[ko] Never call this in production.', '[ko] It is slow.']);
  assert.equal(await page.$eval('#em-outside .tfd-sentence:first-of-type > strong', (el) => el.textContent), '[ko] Never call this in production.');
  assert.equal(await page.$$eval('#em-outside .tfd-sentence:last-of-type strong', (els) => els.length), 0);

  // 원문 보기로 돌리면 원래 HTML 그대로
  await select('#em-outside', 'Never', 'production');
  assert.equal(await page.$eval('#em-outside .tfd-sentence[data-tfd-state="original"]', (el) => el.innerHTML), '<strong>Never call this in production</strong>.');
});

test('강조 A: 문장이 강조 요소 안에 있으면 그대로 안에 들어가고 중복으로 감싸지 않는다', async () => {
  await select('#em-inside', 'Always', 'input');
  await clickTranslate();
  assert.equal(await page.$eval('#em-inside em > .tfd-sentence', (el) => el.textContent), '[ko] Always validate input.');
  assert.equal(await page.$$eval('#em-inside .tfd-sentence em', (els) => els.length), 0);
});

test('강조 B: 강조 안이 용어나 <code> 하나뿐이면 그 항목에 강조 유지', async () => {
  await select('#em-item', 'Every', 'sparingly');
  await clickTranslate();
  assert.equal(await page.$eval('#em-item .tfd-sentence strong > .tfd-term', (el) => el.textContent), 'closure');
  assert.equal(await page.$eval('#em-item .tfd-sentence em > code', (el) => el.textContent), 'bind()');
});

test('강조: 문장 일부의 일반 단어 강조는 아직 번역문에서 빠진다 (알려진 한계)', async () => {
  await select('#em-partial', 'This', 'words');
  await clickTranslate();
  assert.equal(await page.$$eval('#em-partial .tfd-sentence strong', (els) => els.length), 0);
});

test('링크: 일반 링크는 "한국어[원문]"으로 바꾸고 링크 기능 유지, 조사는 받침에 맞춤', async () => {
  const original = await page.$eval('#links', (el) => el.innerHTML);
  await select('#links', 'See', 'too');
  await clickTranslate();

  const first = await page.$eval('#links .tfd-sentence:nth-of-type(1)', (el) => ({
    text: el.textContent,
    href: el.querySelector('a').getAttribute('href'),
    original: el.querySelector('a .tfd-link-original').textContent,
  }));
  // 번역기가 붙인 마침표는 떼고, "을"은 "가이드"(받침 없음)에 맞춰 "를"로 바뀐다.
  assert.equal(first.text, '자세한 내용은 closures 가이드[the closures guide]를 참조하세요.');
  assert.equal(first.href, '#guide');
  assert.equal(first.original, '[the closures guide]');

  // API 이름 링크와 <code>를 품은 링크는 영어 그대로, 병기 없음
  const second = await page.$eval('#links .tfd-sentence:nth-of-type(2)', (el) => ({
    links: [...el.querySelectorAll('a')].map((a) => a.textContent),
    originals: el.querySelectorAll('.tfd-link-original').length,
  }));
  assert.deepEqual(second.links, ['Promise', 'map()']);
  assert.equal(second.originals, 0);

  // 6단어 넘는 링크는 병기 대신 원문 툴팁
  const long = await page.$eval('#links a[href="#long"]', (a) => ({ text: a.textContent, title: a.title }));
  assert.deepEqual(long, { text: '여섯 단어보다 긴 아주 긴 링크 글자', title: '원문: very long link text that spans more than six words here' });

  // 번역 결과가 영어 그대로면 원래 링크 그대로
  assert.equal(await page.$eval('#links a[href="#same"]', (a) => a.outerHTML), '<a href="#same">Vite docs</a>');

  // 원문 보기로 돌리면 원래 링크 그대로
  for (const [start, end] of [['자세한', '내용은'], ['[ko] Read', 'Read'], ['[ko] ', 'exists'], ['[ko] Check', 'Check']]) {
    await select('#links', start, end);
  }
  const restored = await page.$$eval('#links .tfd-sentence', (els) => els.map((el) => el.innerHTML).join(' '));
  assert.equal(restored, original);
});

test('<pre> 코드 블록과 한국어 문단은 번역하지 않는다', async () => {
  const before = await page.evaluate(() => window.__translated.length);
  await select('#code', 'const', 'price');
  if (await buttonBox()) await clickTranslate();
  assert.equal(await page.$$eval('#code .tfd-sentence', (els) => els.length), 0);

  await select('#ko', '이미', '문단입니다');
  assert.equal(await buttonBox(), null);
  assert.equal(await page.evaluate(() => window.__translated.length), before);
});
