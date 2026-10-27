'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { splitSentences } = require('../src/core/sentence-splitter');

const texts = (input) => splitSentences(input).map((s) => s.text);

// 공식문서에서 자주 나오는 경우를 모은 회귀 테스트 세트. 틀리는 문장을 발견하면 여기에 추가한다.
const CASES = [
  ['기본 마침표', 'This is one. This is two.', ['This is one.', 'This is two.']],
  ['물음표/느낌표', 'Does it work? Yes! It does.', ['Does it work?', 'Yes!', 'It does.']],
  ['e.g. 뒤 대문자', 'Use a bundler, e.g. Webpack or Vite. Then run it.', ['Use a bundler, e.g. Webpack or Vite.', 'Then run it.']],
  ['i.e. 뒤 대문자', 'Pass a primitive, i.e. A string. Done.', ['Pass a primitive, i.e. A string.', 'Done.']],
  ['괄호 안 약어', 'Some types (e.g. Map) are iterable. Others are not.', ['Some types (e.g. Map) are iterable.', 'Others are not.']],
  ['vs.', 'Compare let vs. Const declarations. Pick one.', ['Compare let vs. Const declarations.', 'Pick one.']],
  ['Dr. 같은 호칭', 'Dr. Smith wrote the spec. It is long.', ['Dr. Smith wrote the spec.', 'It is long.']],
  ['점이 든 이름', 'Node.js is a runtime. Next.js builds on React.', ['Node.js is a runtime.', 'Next.js builds on React.']],
  ['메서드 호출', 'Call array.map() to transform items. It returns a new array.', ['Call array.map() to transform items.', 'It returns a new array.']],
  ['버전 번호', 'Upgrade to v1.2.3 first. Then restart.', ['Upgrade to v1.2.3 first.', 'Then restart.']],
  ['소수', 'The ratio is 3.14 here. Keep it.', ['The ratio is 3.14 here.', 'Keep it.']],
  ['파일 이름', 'Edit config.yaml and save. Reload the page.', ['Edit config.yaml and save.', 'Reload the page.']],
  ['URL', 'See https://example.com/docs.html for details. Thanks.', ['See https://example.com/docs.html for details.', 'Thanks.']],
  ['말줄임표 + 소문자', 'Wait... it still works. Good.', ['Wait... it still works.', 'Good.']],
  ['줄바꿈은 문장을 끊지 않음',
    'You know you\'ve achieved perfection in design,\nNot when you have nothing more to add,\nBut when you have nothing more to take away.',
    ['You know you\'ve achieved perfection in design, Not when you have nothing more to add, But when you have nothing more to take away.']],
  ['마침표 없는 제목', 'Structures and Unions', ['Structures and Unions']],
  ['따옴표 안 마침표', 'He said "use strict." Then he left.', ['He said "use strict."', 'Then he left.']],
  ['DOM 요소 자리 문자', 'Use \ue000 to start. Then call \ue001.', ['Use \ue000 to start.', 'Then call \ue001.']],
  ['etc.는 문장 끝일 수 있음', 'Supports Map, Set, etc. Other types are ignored.', ['Supports Map, Set, etc.', 'Other types are ignored.']],
];

for (const [name, input, expected] of CASES) {
  test(`splitSentences: ${name}`, () => {
    assert.deepEqual(texts(input), expected);
  });
}

test('splitSentences: 오프셋이 원문 위치를 가리킨다', () => {
  const input = '  First one.   Second one.  ';
  for (const s of splitSentences(input)) {
    assert.equal(input.slice(s.start, s.end), s.text);
  }
});

test('splitSentences: 빈 문자열', () => {
  assert.deepEqual(splitSentences(''), []);
  assert.deepEqual(splitSentences('   '), []);
});
