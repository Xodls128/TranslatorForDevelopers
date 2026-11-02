'use strict';

/*
 * 번역기 진단 페이지: 가짜 번역기로 실행해 요약·형식 비교·묶어 번역·예문별 표가 맞게 나오는지 확인한다.
 * 가짜 번역기는 지금 형식의 토큰 ⟦1⟧을 일부러 빠뜨린다. (다른 형식 [[1]], {1}은 그대로 둔다)
 *
 * 실행: npm run test:e2e
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launchBrowser } = require('./browser');

const ROOT = path.resolve(__dirname, '../..');
require(path.join(ROOT, 'src/data/terms'));
const { createTermDetector } = require(path.join(ROOT, 'src/core/term-detector'));
const { protectSentence } = require(path.join(ROOT, 'src/core/protector'));
const { DIAGNOSTIC_SAMPLES } = require(path.join(ROOT, 'src/data/diagnostic-samples'));

const FAKE = `
  const data = {};
  window.chrome = { storage: { local: {
    async get(key) { return key in data ? { [key]: data[key] } : {}; },
    async set(items) { Object.assign(data, JSON.parse(JSON.stringify(items))); },
  } } };
  window.__creates = 0;
  window.Translator = {
    availability: async () => 'available',
    create: async () => { window.__creates++; return { translate: async (t) => t.split('\\n').map((line) => '[ko] ' + line.replace(/⟦1⟧/g, '')).join('\\n') }; },
  };
`;

let browser;

test.before(async () => {
  browser = await launchBrowser();
});

test.after(async () => {
  await browser.close();
});

// 예문 중 토큰이 있는 문장 수와, ⟦1⟧이 없어서(토큰 1개) 보존되는 문장 수
function expected() {
  const counts = DIAGNOSTIC_SAMPLES.map((s) => protectSentence(s.text, createTermDetector({ packs: s.packs || [] })).items.length);
  const withTokens = counts.filter((n) => n > 0).length;
  const preserved = counts.filter((n) => n === 1).length;
  const batchGroups = Math.floor(DIAGNOSTIC_SAMPLES.filter((s) => s.batch).length / 3);
  return { withTokens, preserved, batchGroups };
}

const text = (page, id) => page.$eval(`#${id}`, (el) => el.textContent);

test('진단 실행: 토큰 보존율·형식 비교·묶어 번역·예문별 표', async () => {
  const page = await browser.newPage();
  await page.addInitScript(FAKE);
  await page.goto('file://' + path.join(ROOT, 'src/diagnostics/diagnostics.html'));
  await page.waitForFunction(() => /사용 가능/.test(document.getElementById('state').textContent));
  await page.click('#run');
  await page.waitForFunction(() => !document.getElementById('results').hidden && !document.getElementById('run').disabled);

  const e = expected();
  const pctOf = (a, b) => `${Math.round((a / b) * 100)}%`;
  assert.match(await text(page, 'summary'), new RegExp(`토큰 보존율${pctOf(e.preserved, e.withTokens)} \\(${e.preserved}/${e.withTokens}문장\\)`));
  assert.match(await text(page, 'summary'), /번역기 생성 시간\d+ms/);
  // 다른 형식은 가짜 번역기가 건드리지 않아 모두 보존된다.
  const formats = await text(page, 'formats');
  assert.match(formats, new RegExp(`\\[\\[0\\]\\]100% \\(${e.withTokens}/${e.withTokens}문장\\)`));
  assert.match(formats, new RegExp(`\\{0\\}100% \\(${e.withTokens}/${e.withTokens}문장\\)`));
  // 묶음: ⟦1⟧이 있는 문장이 섞인 묶음은 토큰 검사에서 깨진다. 묶음 수만 확인한다.
  assert.match(await text(page, 'batch'), new RegExp(`/${e.batchGroups}`));
  assert.equal(await page.$$eval('#rows tr', (rows) => rows.length), DIAGNOSTIC_SAMPLES.length);
  assert.equal(await page.evaluate(() => window.__creates), 1);

  // 표: 토큰 2개 이상인 문장은 "누락 ⟦1⟧"
  const statuses = await page.$$eval('#rows tr td:nth-child(3)', (tds) => tds.map((td) => td.textContent));
  assert.ok(statuses.includes('누락 ⟦1⟧'));
  assert.ok(statuses.includes('정상 (토큰 없음)'));

  // 페이지 요소 자리는 표시용 글자로 보인다.
  const originals = await page.$$eval('#rows tr td:nth-child(5)', (tds) => tds.map((td) => td.textContent));
  assert.ok(originals.includes('Call [useEffect()] inside the component.'));
  await page.close();
});

test('마지막 결과를 이 기기(chrome.storage.local)에 저장한다', async () => {
  const page = await browser.newPage();
  await page.addInitScript(FAKE);
  await page.goto('file://' + path.join(ROOT, 'src/diagnostics/diagnostics.html'));
  await page.click('#run');
  await page.waitForFunction(() => !document.getElementById('results').hidden && !document.getElementById('run').disabled);
  const saved = await page.evaluate(async () => (await chrome.storage.local.get('diagnostics:last'))['diagnostics:last']);
  assert.ok(saved && saved.rows.length > 0);
  await page.close();
});
