'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/data/terms');
const { createTermDetector } = require('../src/core/term-detector');
const { protectSentence, restoreSentence, fixParticle, atomChar } = require('../src/core/protector');
const { buildSearchQuery, buildSearchUrl } = require('../src/core/search-query');

const detector = createTermDetector();

function render(parts) {
  return parts.map((p) => (p.type === 'text' ? p.text : p.item.kind === 'atom' ? `<atom${p.item.atomIndex}>` : p.item.text)).join('');
}

test('protectSentence: 용어, 코드, DOM 요소를 토큰으로 바꾼다', () => {
  const text = `A closure can call ${atomChar(0)} or useState().`;
  const { source, items } = protectSentence(text, detector);
  assert.equal(source, 'A ⟦0⟧ can call ⟦1⟧ or ⟦2⟧.');
  assert.deepEqual(items.map((i) => i.kind), ['term', 'atom', 'code']);
});

test('restoreSentence: 토큰 복원 + 조사 병기', () => {
  const { items } = protectSentence(`A closure can call ${atomChar(0)}.`, detector);
  const result = restoreSentence('⟦0⟧는 ⟦1⟧를 호출할 수 있습니다.', items);
  assert.equal(result.ok, true);
  assert.equal(render(result.parts), 'closure은(는) <atom0>을(를) 호출할 수 있습니다.');
});

test('restoreSentence: 토큰이 사라지거나 중복되면 실패', () => {
  const { items } = protectSentence('A closure is here.', detector);
  assert.equal(restoreSentence('클로저가 여기 있습니다.', items).ok, false);
  assert.equal(restoreSentence('⟦0⟧ ⟦0⟧', items).ok, false);
  assert.equal(restoreSentence('⟦3⟧', items).ok, false);
});

test('restoreSentence: 토큰 안 공백은 허용', () => {
  const { items } = protectSentence('A closure is here.', detector);
  assert.equal(render(restoreSentence('⟦ 0 ⟧가 있습니다.', items).parts), 'closure이(가) 있습니다.');
});

test('fixParticle', () => {
  assert.equal(fixParticle('는 빠르다'), '은(는) 빠르다');
  assert.equal(fixParticle('이 필요하다'), '이(가) 필요하다');
  assert.equal(fixParticle('를 사용'), '을(를) 사용');
  assert.equal(fixParticle('와 함께'), '과(와) 함께');
  assert.equal(fixParticle('로 변환'), '(으)로 변환');
  assert.equal(fixParticle('으로서 동작'), '(으)로서 동작');
  assert.equal(fixParticle('라는 개념'), '(이)라는 개념');
  // 조사가 아닌 경우는 그대로
  assert.equal(fixParticle('입니다.'), '입니다.');
  assert.equal(fixParticle('이다.'), '이다.');
  assert.equal(fixParticle('가능합니다'), '가능합니다');
  assert.equal(fixParticle(' 이 방법'), ' 이 방법');
});

test('buildSearchQuery / buildSearchUrl', () => {
  assert.equal(buildSearchQuery('Union'), '프로그래밍언어 Union');
  assert.equal(buildSearchQuery('Union', { topic: 'C' }), 'C에서 Union이란');
  assert.equal(buildSearchUrl('프로그래밍언어 Union'), 'https://www.google.com/search?q=%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%98%EB%B0%8D%EC%96%B8%EC%96%B4%20Union');
});
