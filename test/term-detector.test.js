'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/data/terms');
const { createTermDetector, isTitleCase } = require('../src/core/term-detector');

const detector = createTermDetector();
const found = (text, d = detector) => d.detect(text).map((s) => `${s.kind}:${s.text}`);

test('exact: 고유명사는 대소문자가 맞을 때만', () => {
  assert.deepEqual(found('Learn JavaScript and C++ today.'), ['term:JavaScript', 'term:C++']);
  assert.deepEqual(found('I drink java every morning.'), []);
});

test('word: 일반 영어와 겹치지 않는 용어는 항상 보존 (복수형 포함)', () => {
  assert.deepEqual(found('A closure captures variables. Callbacks run later.'), ['term:closure', 'term:Callbacks']);
});

test('context: 문장 중간 대문자형은 보존', () => {
  assert.deepEqual(found('Return a Promise from the handler.'), ['term:Promise']);
});

test('context: 일반 소문자 사용은 번역', () => {
  assert.deepEqual(found('I promise this class of problems is rare.'), []);
});

test('context: 단서 단어가 뒤에 오면 소문자도 보존', () => {
  assert.deepEqual(found('Declare a union type first.'), ['term:union']);
});

test('context: 문장 첫 단어 대문자는 일반 문장이면 보존하지 않음', () => {
  assert.deepEqual(found('Structures are rarely needed here.'), []);
});

test('context: 제목형 문장은 첫 단어도 보존', () => {
  assert.deepEqual(found('Structures and Unions'), ['term:Structures', 'term:Unions']);
});

test('code: 태그 없는 코드 조각', () => {
  assert.deepEqual(found('Call useState() inside the component.'), ['code:useState()']);
  assert.deepEqual(found('Set max_retries in config.yaml first.'), ['code:max_retries', 'code:config.yaml']);
  assert.deepEqual(found('Run npm install --save-dev now.'), ['term:npm', 'code:--save-dev']);
  assert.deepEqual(found('Edit ./src/index.js and reload.'), ['code:./src/index.js']);
  assert.deepEqual(found('The fetchData helper returns JSON.'), ['code:fetchData', 'code:JSON']);
});

test('code: 약어(e.g, U.S)와 안내 문구(NOTE)는 코드가 아님', () => {
  assert.deepEqual(found('NOTE: use a tool, e.g. a linter.'), ['term:linter']);
});

test('code: "item(s)" 같은 복수 표기는 함수 호출이 아님', () => {
  assert.deepEqual(found('Select the item(s) you need.'), []);
});

test('겹치는 후보는 용어(term)를 우선', () => {
  assert.deepEqual(found('TypeScript adds types.'), ['term:TypeScript']);
});

test('사용자 설정: 추가 용어와 제외 용어', () => {
  const custom = createTermDetector({ extraTerms: ['borrow checker', 'Riverpod2'], excludedTerms: ['closure'] });
  assert.deepEqual(found('The borrow checker rejects this closure.', custom), ['term:borrow checker']);
  assert.deepEqual(found('Migrate to Riverpod2 soon.', custom), ['term:Riverpod2']);
});

test('isTitleCase', () => {
  assert.equal(isTitleCase('Structures and Unions'), true);
  assert.equal(isTitleCase('Unions are useful.'), false);
});
