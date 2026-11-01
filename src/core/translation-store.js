/*
 * 번역 결과 저장 (기기 안, chrome.storage.local)
 *
 * 한 번 번역한 문장은 브라우저를 껐다 켜도, 다른 사이트에서 같은 문장이 나와도 번역기를 다시 부르지 않는다.
 * - 키: 번역기에 넣은 문자열(보호 처리 후)의 해시. 형식 버전을 붙여, 토큰 형식이 바뀌면 옛 기록을 자연히 무시한다.
 * - 값: 번역기의 원래 출력과 마지막으로 쓴 날. 조사 병기 등 후처리는 매번 다시 하므로 후처리를 고쳐도 기록은 그대로 쓴다.
 * - 쓰기는 모아서 한 번에 하고, 용량이 한도를 넘으면 오래 안 쓴 기록부터 지운다.
 * 저장소는 바꿔 끼울 수 있다. (확장에서는 chrome.storage.local, 테스트에서는 가짜 저장소)
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  const PREFIX = 't:';
  const VERSION = 'v1'; // 토큰 형식이나 번역 언어가 바뀌면 올린다.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const DEFAULTS = {
    limitBytes: 8 * 1024 * 1024, // chrome.storage.local 기본 한도(약 10MB) 안에서 여유를 둔다.
    trimRatio: 0.2, // 한도를 넘으면 오래 안 쓴 기록부터 이만큼 지운다.
    checkEvery: 50, // 이만큼 기록할 때마다 용량을 확인한다.
    flushDelayMs: 1000, // 쓰기를 이만큼 모았다가 한 번에 기록한다.
  };

  // 64비트 해시(cyrb53). 암호용은 아니고 키를 짧게 만드는 용도. 수십만 개 수준에서 충돌 가능성은 무시할 만하다.
  function hash(text) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }

  function keyFor(source, version = VERSION) {
    return `${PREFIX}${version}:${hash(source)}`;
  }

  const isOurKey = (key) => key.startsWith(PREFIX);
  const isCurrentKey = (key) => key.startsWith(`${PREFIX}${VERSION}:`);

  /**
   * @param {object} options
   * @param {object} [options.storage] get/set/remove/getBytesInUse를 Promise로 제공하는 저장소. 없으면 아무것도 저장하지 않는다.
   * @param {() => boolean} [options.enabled] false면 읽지도 쓰지도 않는다. (사용자 설정)
   */
  function createTranslationStore(options = {}) {
    const { storage, enabled = () => true, now = Date.now } = options;
    const config = { ...DEFAULTS, ...options };
    const pending = new Map(); // 기록할 키 → 값
    let timer = null;
    let writesSinceCheck = 0;

    const active = () => !!storage && enabled();
    const today = () => Math.floor(now() / DAY_MS);

    /** 여러 문장을 한 번에 조회한다. @returns {Promise<Map<string, string>>} 번역기 입력 → 저장된 출력 */
    async function getMany(sources) {
      const found = new Map();
      if (!active() || !sources.length) return found;
      const keyOf = new Map(sources.map((s) => [keyFor(s), s]));
      let items;
      try {
        items = await storage.get([...keyOf.keys()]);
      } catch {
        return found; // 저장소 오류여도 번역은 계속한다.
      }
      const day = today();
      for (const [key, entry] of Object.entries(items || {})) {
        if (!entry || typeof entry.v !== 'string') continue;
        found.set(keyOf.get(key), entry.v);
        // 마지막으로 쓴 날을 하루 단위로만 갱신해 쓰기를 줄인다. (용량 정리 때 오래된 것부터 지우는 기준)
        if (entry.t !== day) schedule(key, { v: entry.v, t: day });
      }
      return found;
    }

    /** 번역기 출력을 기록한다. (모았다가 한 번에) */
    function put(source, translated) {
      if (!active()) return;
      schedule(keyFor(source), { v: translated, t: today() });
    }

    function schedule(key, value) {
      pending.set(key, value);
      if (!timer) timer = setTimeout(flush, config.flushDelayMs);
    }

    async function flush() {
      clearTimeout(timer);
      timer = null;
      if (!pending.size || !storage) return;
      const batch = Object.fromEntries(pending);
      pending.clear();
      try {
        await storage.set(batch);
        writesSinceCheck += Object.keys(batch).length;
        if (writesSinceCheck >= config.checkEvery) {
          writesSinceCheck = 0;
          await enforceLimit();
        }
      } catch {
        // 용량 초과 등으로 실패하면 정리 후 다음 기회에 다시 쓴다.
        await enforceLimit().catch(() => {});
      }
    }

    /** 용량이 한도를 넘으면 옛 형식 기록을 먼저 지우고, 그래도 넘으면 오래 안 쓴 기록부터 지운다. */
    async function enforceLimit() {
      const bytes = await storage.getBytesInUse(null);
      if (bytes <= config.limitBytes) return 0;
      const all = await storage.get(null);
      const ours = Object.entries(all || {}).filter(([key]) => isOurKey(key));
      const stale = ours.filter(([key]) => !isCurrentKey(key)).map(([key]) => key);
      const current = ours.filter(([key]) => isCurrentKey(key)).sort((a, b) => (a[1].t || 0) - (b[1].t || 0));
      const oldest = current.slice(0, Math.ceil(current.length * config.trimRatio)).map(([key]) => key);
      const remove = [...stale, ...oldest];
      if (remove.length) await storage.remove(remove);
      return remove.length;
    }

    /** 저장된 번역을 모두 지운다. (사용자 설정 외 다른 데이터는 건드리지 않음) */
    async function clear() {
      pending.clear();
      const all = await storage.get(null);
      const keys = Object.keys(all || {}).filter(isOurKey);
      if (keys.length) await storage.remove(keys);
      return keys.length;
    }

    /** @returns {Promise<{entries: number, bytes: number}>} */
    async function usage() {
      const all = await storage.get(null);
      const keys = Object.keys(all || {}).filter(isOurKey);
      const bytes = keys.length ? await storage.getBytesInUse(keys) : 0;
      return { entries: keys.length, bytes };
    }

    return { getMany, put, flush, enforceLimit, clear, usage };
  }

  TFD.createTranslationStore = createTranslationStore;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createTranslationStore, keyFor, hash, VERSION };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
