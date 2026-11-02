'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/data/terms');
const { createTermDetector } = require('../src/core/term-detector');
const { protectSentence } = require('../src/core/protector');
const D = require('../src/core/diagnostics');
const { DIAGNOSTIC_SAMPLES } = require('../src/data/diagnostic-samples');

test('토큰 검사: 누락, 중복, 없는 번호', () => {
  assert.deepEqual(D.tokenIssues('⟦0⟧는 ⟦1⟧를 부릅니다', 2), { ok: true, missing: [], duplicated: [], unknown: [] });
  assert.deepEqual(D.tokenIssues('⟦0⟧는 부릅니다', 2).missing, [1]);
  assert.deepEqual(D.tokenIssues('⟦0⟧ ⟦0⟧ ⟦1⟧', 2).duplicated, [0]);
  assert.deepEqual(D.tokenIssues('⟦0⟧ ⟦1⟧ ⟦5⟧', 2).unknown, [5]);
  // 번역기가 토큰 안에 공백을 넣어도 같은 토큰으로 본다
  assert.equal(D.tokenIssues('⟦ 0 ⟧와 ⟦1⟧', 2).ok, true);
  assert.equal(D.describeIssues(D.tokenIssues('⟦0⟧', 2)), '누락 ⟦1⟧');
});

test('토큰 형식 바꾸기와 되돌리기', () => {
  assert.equal(D.convertTokens('Call ⟦0⟧ and ⟦1⟧.', 'double'), 'Call [[0]] and [[1]].');
  assert.equal(D.convertTokens('Call ⟦0⟧.', 'brace'), 'Call {0}.');
  assert.equal(D.revertTokens('[[ 0 ]]와 [[1]]를 호출', 'double'), '⟦0⟧와 ⟦1⟧를 호출');
  assert.equal(D.revertTokens('{0}를 호출', 'brace'), '⟦0⟧를 호출');
});

test('요약: 보존율은 토큰이 있는 문장만, 시간은 시간 초과 제외', () => {
  const s = D.summarize([
    { tokens: 0, ok: true, ms: 100 },
    { tokens: 2, ok: true, ms: 50 },
    { tokens: 1, ok: false, ms: 30 },
    { tokens: 1, ok: false, ms: 20000, timeout: true },
  ]);
  assert.equal(s.withTokens, 3);
  assert.equal(s.preserved, 1);
  assert.equal(Math.round(s.survival * 100), 33);
  assert.equal(s.firstMs, 100);
  assert.equal(s.medianMs, 50);
  assert.equal(s.maxMs, 100);
  assert.equal(s.timeouts, 1);
});

test('묶어 번역: 줄로 묶고 나누기', () => {
  assert.equal(D.joinBatch(['A.', 'B.', 'C.']), 'A.\nB.\nC.');
  assert.deepEqual(D.splitBatch('가.\n\n나.\n 다. '), ['가.', '나.', '다.']);
});

test('예문: 분류별로 토큰이 기대대로 생긴다', () => {
  const count = (sample) => protectSentence(sample.text, createTermDetector({ packs: sample.packs || [] })).items.length;
  for (const s of DIAGNOSTIC_SAMPLES.filter((x) => x.category === '기본')) assert.equal(count(s), 0, s.text);
  for (const s of DIAGNOSTIC_SAMPLES.filter((x) => x.category === '토큰 많음')) assert.ok(count(s) >= 5, s.text);
  for (const s of DIAGNOSTIC_SAMPLES.filter((x) => ['용어', '코드 조각', '로우레벨', '페이지 요소'].includes(x.category))) assert.ok(count(s) >= 1, s.text);
  // 묶어 번역 실험용 예문은 페이지 요소 자리가 없다
  for (const s of DIAGNOSTIC_SAMPLES.filter((x) => x.batch)) assert.doesNotMatch(s.text, /[\ue000-\uf8ff]/, s.text);
});

test('보고서: 요약과 예문별 표', () => {
  const rows = [{ category: '기본', display: 'Hi.', status: '정상 (토큰 없음)', ms: 12, restored: '안녕.', tokens: 0, ok: true }];
  const text = D.formatReport({ date: '오늘', browser: 'Chrome 151', availability: 'available', createMs: 120, summary: D.summarize(rows), rows,
    formats: [{ label: '[[0]]', survival: 1, preserved: 3, total: 3 }], batch: { groups: 2, intact: 1, batchMs: 100, singleMs: 300 } });
  assert.match(text, /토큰 보존율: - \(0\/0문장\)/);
  assert.match(text, /번역기 생성 시간: 120ms/);
  assert.match(text, /\[\[0\]\]: 보존율 100% \(3\/3문장\)/);
  assert.match(text, /\| 1 \| 기본 \| 정상 \(토큰 없음\) \| 12ms \| Hi\. \| 안녕\. \|/);
});
