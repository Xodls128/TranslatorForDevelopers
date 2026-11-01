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

test('로우레벨: 레지스터·매크로·C 타입은 기존 규칙으로 보존', () => {
  assert.deepEqual(found('Write 1 to bit 5 of GPIOA_MODER to enable the pin.'), ['code:GPIOA_MODER']);
  assert.deepEqual(found('Pass GPIO_NUM_2 as a uint32_t value.'), ['code:GPIO_NUM_2', 'code:uint32_t']);
});

test('로우레벨: 16진수·2진수', () => {
  assert.deepEqual(found('Set the register to 0xFF and read back 0b1010.'), ['code:0xFF', 'code:0b1010']);
  assert.deepEqual(found('The peripheral base address is 0x4002_0000.'), ['code:0x4002_0000']);
});

test('로우레벨: 비트 범위는 대괄호 또는 bit/bits/field 뒤에서만', () => {
  assert.deepEqual(found('Bits [31:16] are reserved.'), ['code:[31:16]']);
  assert.deepEqual(found('The field occupies bits 7:4 of the CR1 register.'), ['code:7:4', 'code:CR1']);
  assert.deepEqual(found('The meeting starts at 10:30 today.'), []);
  assert.deepEqual(found('The ratio is 1:64 here.'), []);
});

test('로우레벨: 숫자와 단위는 한 덩어리로', () => {
  assert.deepEqual(found('Supply voltage must not exceed 3.3V here.'), ['code:3.3V']);
  assert.deepEqual(found('Each pin can source up to 16 mA.'), ['code:16 mA']);
  assert.deepEqual(found('The core runs at 240 MHz with 520 KB of SRAM.'), ['code:240 MHz', 'code:520 KB', 'code:SRAM']);
  assert.deepEqual(found('A 10kΩ resistor and a 1 µs tick at -40 °C.'), ['code:10kΩ', 'code:1 µs', 'code:-40 °C']);
  assert.deepEqual(found('The motor draws 2A at 12 V.'), ['code:2A', 'code:12 V']);
});

test('로우레벨: 일반 단어 단위, 연대, 관사 A는 단위로 보지 않음', () => {
  assert.deepEqual(found('It takes 10 seconds and 32 bits.'), []);
  assert.deepEqual(found('This was popular in the 1990s.'), []);
  assert.deepEqual(found('Step 2 A function is called.'), []);
  assert.deepEqual(found('Plan B is to wait 2 weeks.'), []);
});

test('로우레벨: 하이픈으로 이은 부품·규격명은 통째로', () => {
  assert.deepEqual(found('Version 5.1.2 adds support for ESP32-C6 and RP2040.'), ['code:ESP32-C6', 'code:RP2040']);
  assert.deepEqual(found('It uses a 2.4GHz quad-core Cortex-A76.'), ['code:2.4GHz', 'code:Cortex-A76']);
  assert.deepEqual(found('Use UTF-8 and x86-64 builds.'), ['code:UTF-8', 'code:x86-64']);
});

test('로우레벨: 하이픈 일반 표현은 부품명으로 보지 않음', () => {
  assert.deepEqual(found('Use a pull-up resistor on the line.'), []);
  assert.deepEqual(found('See the top-10 list for 2-3 examples.'), []);
  assert.deepEqual(found('The e-mail and Wi-Fi settings are built-in.'), []);
});

test('로우레벨: 오류 코드는 앞의 - 까지', () => {
  assert.deepEqual(found('The return value is -EINVAL if the argument is invalid.'), ['code:-EINVAL']);
});
