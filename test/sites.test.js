'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TERM_PACKS } = require('../src/data/terms');
const { SITES, resolveSite } = require('../src/data/sites');
const { buildSearchQuery } = require('../src/core/search-query');

test('사이트 판별: 묶음과 검색 맥락', () => {
  assert.deepEqual(resolveSite('react.dev', '/reference/react/useEffect'), { packs: ['web'], topic: 'React' });
  assert.deepEqual(resolveSite('docs.kernel.org', '/core-api/'), { packs: ['systems'], topic: '리눅스 커널' });
  assert.deepEqual(resolveSite('docs.espressif.com', '/projects/esp-idf/'), { packs: ['embedded'], topic: 'ESP-IDF' });
});

test('사이트 판별: www와 하위 도메인, 경로 조건', () => {
  assert.deepEqual(resolveSite('www.raspberrypi.com', '/documentation/computers/'), { packs: ['embedded'], topic: 'Raspberry Pi' });
  assert.deepEqual(resolveSite('www.raspberrypi.com', '/products/'), { packs: [], topic: '' });
  assert.deepEqual(resolveSite('ko.react.dev', '/learn'), { packs: ['web'], topic: 'React' });
  // 이름만 비슷한 다른 도메인은 해당하지 않는다.
  assert.deepEqual(resolveSite('notreact.dev', '/'), { packs: [], topic: '' });
});

test('사이트 판별: MDN은 경로로 검색 맥락을 정한다', () => {
  assert.equal(resolveSite('developer.mozilla.org', '/en-US/docs/Web/JavaScript/Closures').topic, 'JavaScript');
  assert.equal(resolveSite('developer.mozilla.org', '/ko/docs/Web/CSS/display').topic, 'CSS');
  assert.equal(resolveSite('developer.mozilla.org', '/en-US/docs/Web/API/fetch').topic, 'Web API');
  assert.equal(resolveSite('developer.mozilla.org', '/en-US/docs/Learn').topic, '');
});

test('사이트 판별: 표에 없는 사이트는 기본 사전만', () => {
  assert.deepEqual(resolveSite('example.com', '/'), { packs: [], topic: '' });
  assert.deepEqual(resolveSite('', '/tmp/fixture.html'), { packs: [], topic: '' });
});

test('사이트 표의 묶음 이름은 모두 실제 묶음이다', () => {
  for (const site of SITES) for (const name of site.packs) assert.ok(name in TERM_PACKS, `${site.host}: ${name}`);
});

test('검색어: 사이트 맥락이 있으면 "React에서 Suspense이란"', () => {
  assert.equal(buildSearchQuery('Suspense', { topic: resolveSite('react.dev').topic }), 'React에서 Suspense이란');
  assert.equal(buildSearchQuery('union', { topic: '' }), '프로그래밍언어 union');
});
