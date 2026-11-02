'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findComments, commentLines, groupLines, splitTranslation, isEnglishComment } = require('../src/core/comment-finder');

// 주석 본문만 뽑는다.
const bodies = (text, lang) => commentLines(text, findComments(text, lang)).map((s) => text.slice(s.bodyStart, s.bodyEnd));

test('JS: 줄 주석과 블록 주석, 문자열 안의 //와 URL은 제외', () => {
  const code = [
    '// Fetch the user first',
    'const url = "https://example.com"; // trailing note',
    "const s = 'a // not a comment';",
    '/* block comment',
    ' * second line */',
  ].join('\n');
  assert.deepEqual(bodies(code, 'js'), ['Fetch the user first', 'trailing note', 'block comment', 'second line']);
});

test('YAML·Python: #만 주석, 문자열 안과 단어 중간의 #은 제외', () => {
  const code = ['# This is the pod template', 'name: "a # b"', 'url: http://x.dev/#frag', 'kind = 1  # shared by all'].join('\n');
  assert.deepEqual(bodies(code, 'yaml'), ['This is the pod template', 'shared by all']);
  assert.deepEqual(bodies(code, 'python'), ['This is the pod template', 'shared by all']);
});

test('셸·콘솔 블록은 기호로 찾지 않는다 (#이 프롬프트일 수 있음)', () => {
  assert.deepEqual(findComments('# apt install curl\n$ ls # list', 'bash'), []);
  assert.deepEqual(findComments('# apt install curl', 'console'), []);
});

test('언어를 모를 때: #은 줄 시작·공백 뒤 + 공백이 이어질 때만, 전처리기와 #!은 제외', () => {
  const code = ['#include <stdio.h>', '#!/bin/sh', '# real comment here', 'x = a#b', '// slash comment'].join('\n');
  assert.deepEqual(bodies(code, ''), ['real comment here', 'slash comment']);
});

test('HTML·XML·SQL·CSS', () => {
  assert.deepEqual(bodies('<!-- more bean definitions go here -->\n<bean/>', 'xml'), ['more bean definitions go here']);
  assert.deepEqual(bodies('SELECT 1; -- pick one row', 'sql'), ['pick one row']);
  assert.deepEqual(bodies('a { color: red; } /* the main color */', 'css'), ['the main color']);
  // CSS에서 //는 주석이 아니다
  assert.deepEqual(bodies('a { background: url(//cdn.dev/x.png); }', 'css'), []);
});

test('줄 정보: 줄 번호, 줄 전체가 주석인지', () => {
  const code = 'let a = 1; // one\n// two\n  // three';
  const lines = commentLines(code, findComments(code, 'js'));
  assert.deepEqual(lines.map((s) => [s.line, s.whole]), [[0, false], [1, true], [2, true]]);
});

test('묶기: 이어지는 줄 전체 주석은 한 묶음, 코드 뒤 주석과 사이에 코드가 있으면 따로', () => {
  const code = ['// This function fetches the user and', '// caches the result for later calls.', 'run(); // trailing', 'x();', '// alone'].join('\n');
  const groups = groupLines(commentLines(code, findComments(code, 'js')));
  assert.deepEqual(groups.map((g) => g.map((s) => code.slice(s.bodyStart, s.bodyEnd))), [
    ['This function fetches the user and', 'caches the result for later calls.'],
    ['trailing'],
    ['alone'],
  ]);
});

test('묶기: 여러 줄 블록 주석은 한 묶음', () => {
  const code = '/*\n * Returns the value\n * or null.\n */\nf();';
  const groups = groupLines(commentLines(code, findComments(code, 'c')));
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((s) => code.slice(s.bodyStart, s.bodyEnd)).filter(Boolean), ['Returns the value', 'or null.']);
});

test('번역문 나누기: 줄 수 유지, 단어 경계에서', () => {
  const parts = splitTranslation('이 함수는 사용자를 가져오고 나중 호출을 위해 결과를 캐시합니다.', [36, 34]);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => p.length > 0));
  assert.equal(parts.join(' '), '이 함수는 사용자를 가져오고 나중 호출을 위해 결과를 캐시합니다.');
  // 단어가 줄보다 적으면 남는 줄은 빈 칸
  assert.deepEqual(splitTranslation('짧음', [10, 10, 10]), ['짧음', '', '']);
  assert.deepEqual(splitTranslation('한 줄', [5]), ['한 줄']);
});

test('번역할 주석: 영어 단어가 있어야 한다', () => {
  assert.equal(isEnglishComment('=> 1'), false);
  assert.equal(isEnglishComment('...'), false);
  assert.equal(isEnglishComment('data can be mutated'), true);
  assert.equal(isEnglishComment('이미 한국어 주석'), false);
});
