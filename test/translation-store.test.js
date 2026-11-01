'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTranslationStore, keyFor, VERSION } = require('../src/core/translation-store');

// chrome.storage.local을 흉내 낸 가짜 저장소. 용량은 Chrome처럼 "키 길이 + 값의 JSON 길이"로 센다.
function fakeStorage(initial = {}) {
  const data = { ...initial };
  const calls = { set: 0 };
  const size = (keys) => keys.reduce((sum, k) => sum + k.length + JSON.stringify(data[k]).length, 0);
  return {
    data,
    calls,
    failGet: false,
    async get(keys) {
      if (this.failGet) throw new Error('boom');
      if (keys === null) return { ...data };
      return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));
    },
    async set(items) {
      calls.set++;
      Object.assign(data, items);
    },
    async remove(keys) {
      for (const k of keys) delete data[k];
    },
    async getBytesInUse(keys) {
      return size(keys === null ? Object.keys(data) : keys.filter((k) => k in data));
    },
  };
}

const DAY = 24 * 60 * 60 * 1000;

test('keyFor: 같은 입력은 같은 키, 형식 버전이 다르면 다른 키', () => {
  assert.equal(keyFor('A ⟦0⟧ is here.'), keyFor('A ⟦0⟧ is here.'));
  assert.notEqual(keyFor('A ⟦0⟧ is here.'), keyFor('A ⟦1⟧ is here.'));
  assert.notEqual(keyFor('same', VERSION), keyFor('same', 'v0'));
  assert.match(keyFor('same'), new RegExp(`^t:${VERSION}:[0-9a-f]{16}$`));
});

test('put은 모았다가 한 번에 기록하고, getMany로 꺼낸다', async () => {
  const storage = fakeStorage();
  const store = createTranslationStore({ storage, flushDelayMs: 10_000 });
  store.put('one', '하나');
  store.put('two', '둘');
  assert.equal(storage.calls.set, 0);
  await store.flush();
  assert.equal(storage.calls.set, 1);
  const found = await store.getMany(['one', 'two', 'three']);
  assert.deepEqual([...found.entries()], [['one', '하나'], ['two', '둘']]);
});

test('저장을 끄면 읽지도 쓰지도 않는다', async () => {
  const storage = fakeStorage();
  let on = false;
  const store = createTranslationStore({ storage, enabled: () => on });
  store.put('one', '하나');
  await store.flush();
  assert.deepEqual(storage.data, {});
  on = true;
  store.put('one', '하나');
  await store.flush();
  on = false;
  assert.equal((await store.getMany(['one'])).size, 0);
});

test('저장소 오류가 나도 빈 결과로 계속한다', async () => {
  const storage = fakeStorage();
  storage.failGet = true;
  const store = createTranslationStore({ storage });
  assert.equal((await store.getMany(['one'])).size, 0);
});

test('저장소가 없으면(테스트 페이지 등) 아무것도 하지 않는다', async () => {
  const store = createTranslationStore({});
  store.put('one', '하나');
  await store.flush();
  assert.equal((await store.getMany(['one'])).size, 0);
});

test('용량 한도를 넘으면 옛 형식 기록을 먼저, 그다음 오래 안 쓴 기록부터 지운다', async () => {
  let clock = 0;
  const storage = fakeStorage({ 't:v0:old': { v: '옛 형식', t: 0 }, settingsLike: { keep: true } });
  const store = createTranslationStore({ storage, now: () => clock, limitBytes: 0, trimRatio: 0.5, checkEvery: 1000 });
  for (let day = 0; day < 4; day++) {
    clock = day * DAY;
    store.put(`s${day}`, `문장${day}`);
    await store.flush();
  }
  const removed = await store.enforceLimit();
  assert.equal(removed, 3); // 옛 형식 1개 + 현재 형식 4개 중 오래된 2개
  assert.ok(!('t:v0:old' in storage.data));
  assert.equal((await store.getMany(['s0', 's1'])).size, 0);
  assert.equal((await store.getMany(['s2', 's3'])).size, 2);
  assert.ok('settingsLike' in storage.data, '번역 기록이 아닌 데이터는 건드리지 않는다');
});

test('기록을 꺼내 쓰면 마지막으로 쓴 날이 갱신되어 정리 대상에서 밀린다', async () => {
  let clock = 0;
  const storage = fakeStorage();
  const store = createTranslationStore({ storage, now: () => clock });
  store.put('old', '오래됨');
  store.put('used', '자주 씀');
  await store.flush();
  clock = 5 * DAY;
  await store.getMany(['used']);
  await store.flush();
  assert.equal(storage.data[keyFor('used')].t, 5);
  assert.equal(storage.data[keyFor('old')].t, 0);
});

test('기록한 개수가 일정 수를 넘을 때마다 용량을 확인한다', async () => {
  const storage = fakeStorage();
  const store = createTranslationStore({ storage, limitBytes: 0, checkEvery: 2, trimRatio: 1 });
  store.put('a', '가');
  await store.flush();
  assert.equal(Object.keys(storage.data).length, 1);
  store.put('b', '나');
  await store.flush(); // 2개째에서 확인 → 한도 0이라 전부 정리
  assert.equal(Object.keys(storage.data).length, 0);
});

test('clear와 usage는 번역 기록만 다룬다', async () => {
  const storage = fakeStorage({ other: 1 });
  const store = createTranslationStore({ storage });
  store.put('a', '가');
  store.put('b', '나');
  await store.flush();
  const before = await store.usage();
  assert.equal(before.entries, 2);
  assert.ok(before.bytes > 0);
  assert.equal(await store.clear(), 2);
  assert.deepEqual(await store.usage(), { entries: 0, bytes: 0 });
  assert.ok('other' in storage.data);
});
