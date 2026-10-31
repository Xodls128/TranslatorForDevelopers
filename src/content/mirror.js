/*
 * 문단 사본 (React 등 페이지가 관리하는 DOM과 충돌하지 않기 위한 방식)
 *
 * 원본 문단은 내용을 전혀 건드리지 않고 숨김 표시(data-tfd-hidden)만 붙인다.
 * 그 앞에 문단을 통째로 복제한 사본(.tfd-copy)을 두고, 번역·원문 전환은 모두 사본에서 한다.
 *
 * - 페이지가 원본을 바꾸면 → 사본을 새로 만들고, 전에 번역했던 문장을 다시 번역한다. (바뀌지 않은 문장은 캐시)
 * - 페이지가 원본을 지우면 → 사본도 지운다.
 * - 페이지가 원본을 옮기면 → 사본도 원본 앞으로 옮긴다.
 * - 사본의 링크·버튼을 클릭하면 → 원본의 같은 요소에 클릭을 전달해 페이지 원래 동작(React 등)이 실행되게 한다.
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  // 사본을 만들면 입력 내용이 원본과 따로 놀게 되는 요소. 이런 문단은 예전처럼 그 자리에서 번역한다.
  const UNMIRRORABLE = 'input, textarea, select, iframe, video, audio, canvas, [contenteditable=""], [contenteditable="true"]';
  // 클릭을 원본으로 전달할 요소
  const INTERACTIVE = 'a[href], button, summary, label, [role="button"], [role="link"]';
  // 바뀐 문장을 같은 문장으로 볼 단어 겹침 비율
  const SIMILARITY = 0.5;

  const mirrors = new Map(); // 원본 문단 → { owner, copy, deps, version }
  const byCopy = new WeakMap(); // 사본 → mirror
  let observer = null;
  let nextRef = 1;

  function canMirror(owner) {
    const doc = owner.ownerDocument;
    if (owner === doc.body || owner === doc.documentElement || owner.isContentEditable) return false;
    return !owner.querySelector(UNMIRRORABLE);
  }

  function createCopy(owner) {
    // 클릭 전달용 번호. 원본에 먼저 달고 복제하면 사본의 같은 요소도 같은 번호를 갖는다.
    for (const el of owner.querySelectorAll(INTERACTIVE)) {
      if (!el.dataset.tfdRef) el.dataset.tfdRef = String(nextRef++);
    }
    const copy = owner.cloneNode(true);
    copy.removeAttribute('data-tfd-hidden');
    copy.classList.add('tfd-copy');
    return copy;
  }

  function isOurs(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !!el && !!el.closest('.tfd-copy, #' + TFD.UI_HOST_ID);
  }

  function destroy(mirror) {
    TFD.forgetSentences(mirror.copy);
    mirror.copy.remove();
    if (mirror.owner.isConnected) mirror.owner.removeAttribute('data-tfd-hidden');
    mirrors.delete(mirror.owner);
  }

  /** 원본 문단의 사본을 만들어 원본 앞에 두고 원본을 숨긴다. 이미 있으면 그 사본을 돌려준다. */
  function mirrorBlock(owner, deps) {
    const existing = mirrors.get(owner);
    if (existing) {
      existing.deps = deps;
      return existing.copy;
    }
    // 안쪽 문단에 이미 사본이 있으면 정리하고 바깥 문단 전체를 사본으로 만든다.
    for (const mirror of [...mirrors.values()]) if (owner.contains(mirror.owner)) destroy(mirror);

    const copy = createCopy(owner);
    owner.before(copy);
    owner.setAttribute('data-tfd-hidden', '');
    const mirror = { owner, copy, deps, version: 0 };
    mirrors.set(owner, mirror);
    byCopy.set(copy, mirror);
    startObserving();
    // 방금 우리가 한 DOM 변경은 감지 대상에서 뺀다.
    observer.takeRecords();
    return copy;
  }

  function startObserving() {
    if (observer) return;
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
  }

  function onMutations(records) {
    const changed = new Set();
    for (const record of records) {
      if (isOurs(record.target)) continue;
      for (const mirror of mirrors.values()) if (mirror.owner.contains(record.target)) changed.add(mirror);
    }
    for (const mirror of [...mirrors.values()]) {
      if (!mirror.owner.isConnected) {
        destroy(mirror);
        changed.delete(mirror);
      } else if (mirror.owner.previousSibling !== mirror.copy) {
        mirror.owner.before(mirror.copy);
      }
    }
    for (const mirror of changed) rebuild(mirror);
    observer.takeRecords();
  }

  function words(text) {
    return new Set(text.toLowerCase().match(/[a-z0-9]+/g) || []);
  }

  function similarity(a, b) {
    const wa = words(a);
    const wb = words(b);
    if (!wa.size || !wb.size) return 0;
    let common = 0;
    for (const w of wa) if (wb.has(w)) common++;
    return common / (wa.size + wb.size - common);
  }

  /**
   * 새 사본에서 다시 번역할 문장을 고른다.
   * 전에 번역했던 문장과 글자가 같은 문장, 그리고 글자가 바뀌었지만 단어가 절반 이상 겹치는 문장.
   */
  function pickTargets(candidates, previousTexts) {
    const plain = candidates.map((c) => TFD.normalizeText(c.range.toString()));
    const selected = new Set();
    plain.forEach((text, i) => {
      if (previousTexts.includes(text)) selected.add(i);
    });
    for (const old of previousTexts) {
      if (plain.includes(old)) continue;
      let best = -1;
      let bestScore = SIMILARITY;
      plain.forEach((text, i) => {
        const score = similarity(old, text);
        if (!selected.has(i) && score >= bestScore) {
          best = i;
          bestScore = score;
        }
      });
      if (best >= 0) selected.add(best);
    }
    return candidates.filter((_, i) => selected.has(i));
  }

  /** 원본이 바뀌었을 때 사본을 새로 만들고 전에 번역했던 문장을 다시 번역한다. */
  async function rebuild(mirror) {
    const version = ++mirror.version;
    const previous = TFD.sentenceStates(mirror.copy);
    TFD.forgetSentences(mirror.copy);

    const copy = createCopy(mirror.owner);
    mirror.copy.replaceWith(copy);
    mirror.copy = copy;
    byCopy.set(copy, mirror);
    if (!previous.length) return;

    const targets = pickTargets(TFD.collectSentences(null, copy), previous.map((p) => p.text));
    const deps = {
      translate: mirror.deps.backgroundTranslate || mirror.deps.translate,
      detector: mirror.deps.detector,
    };
    // 다시 번역하는 동안 원본이 또 바뀌면 이번 결과는 버린다.
    await TFD.translateTargets(targets, deps, () => mirror.version === version && copy.isConnected);
    if (mirror.version === version) TFD.applySentenceStates(copy, previous);
  }

  /**
   * 사본 안의 링크·버튼 클릭을 원본의 같은 요소로 전달한다. 전달했으면 true.
   * 새 탭 열기 등 수정키를 누른 클릭은 사본 링크의 기본 동작에 맡긴다.
   */
  function forwardClick(e) {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return false;
    const el = e.target instanceof Element && e.target.closest('[data-tfd-ref]');
    const copy = el && el.closest('.tfd-copy');
    const mirror = copy && byCopy.get(copy);
    if (!mirror) return false;
    const original = mirror.owner.querySelector(`[data-tfd-ref="${el.dataset.tfdRef}"]`);
    if (!original) return false;
    e.preventDefault();
    e.stopPropagation();
    original.click();
    return true;
  }

  TFD.canMirror = canMirror;
  TFD.mirrorBlock = mirrorBlock;
  TFD.forwardClick = forwardClick;
})(typeof globalThis !== 'undefined' ? globalThis : this);
