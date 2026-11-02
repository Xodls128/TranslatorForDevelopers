/*
 * 문단 사본 (React 등 페이지가 관리하는 DOM과 충돌하지 않기 위한 방식)
 *
 * 원본 문단은 내용을 전혀 건드리지 않고 숨기기만 한다. (data-tfd-hidden 속성 + 요소에 직접 display:none)
 * 그 앞에 문단을 통째로 복제한 사본(.tfd-copy)을 두고, 번역·원문 전환은 모두 사본에서 한다.
 *
 * - 페이지가 원본을 바꾸면 → 사본을 새로 만들고, 전에 번역했던 문장을 다시 번역한다. (바뀌지 않은 문장은 캐시)
 * - 페이지가 원본을 지우면 → 사본도 지운다.
 * - 페이지가 원본을 옮기면 → 사본도 원본 앞으로 옮긴다.
 * - 사본의 링크·버튼을 클릭하면 → 원본의 같은 요소에 클릭을 전달해 페이지 원래 동작(React 등)이 실행되게 한다.
 * - 사본의 입력창은 입력을 막고, 누르면 그 문단만 원본을 보여 줘서 원본 입력창에 입력하게 한다.
 * - 원본 보기(Shift를 0.3초 이상 누르고 있는 동안) → 모든 사본을 숨기고 원본을 보여 준다.
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  // 복제하면 내용이 비거나 멈추는 요소. 이런 문단은 번역하지 않는다.
  const UNSUPPORTED = 'iframe, video, audio, canvas, object, embed, [contenteditable=""], [contenteditable="true"]';
  // 클릭을 원본으로 전달할 요소
  const INTERACTIVE = 'a[href], button, summary, label, [role="button"], [role="link"]';
  // 사본에서는 입력을 막고, 원본에서 입력하게 할 요소
  const FORM_CONTROLS = 'input, textarea, select';
  // 바뀐 문장을 같은 문장으로 볼 단어 겹침 비율
  const SIMILARITY = 0.5;
  const RESIZE_SETTLE_MS = 200; // 창 크기 조절이 이만큼 멈추면 사본 여백을 다시 맞춘다

  const mirrors = new Map(); // 원본 문단 → mirror
  const byCopy = new WeakMap(); // 사본 → mirror
  let observer = null;
  let nextRef = 1;
  let peeking = false;

  /**
   * @returns {'mirror'|'in-place'|'skip'}
   *   mirror: 사본을 만들어 번역, in-place: 사본 없이 그 자리에서 번역(문서 최상위 글자 등), skip: 번역하지 않음
   */
  function mirrorMode(owner) {
    const doc = owner.ownerDocument;
    if (owner === doc.body || owner === doc.documentElement) return 'in-place';
    if (owner.isContentEditable || owner.querySelector(UNSUPPORTED)) return 'skip';
    return 'mirror';
  }

  function hide(mirror) {
    mirror.owner.setAttribute('data-tfd-hidden', '');
    // 사이트 CSS가 우리 규칙을 덮어써도 숨겨지도록 요소에 직접 지정한다. (요소에 직접 쓴 !important가 가장 우선)
    mirror.owner.style.setProperty('display', 'none', 'important');
  }

  function unhide(mirror) {
    const { owner, display } = mirror;
    owner.removeAttribute('data-tfd-hidden');
    if (display.value) owner.style.setProperty('display', display.value, display.priority);
    else owner.style.removeProperty('display');
    if (owner.getAttribute('style') === '') owner.removeAttribute('style');
  }

  function isHidden(owner) {
    return owner.ownerDocument.defaultView.getComputedStyle(owner).display === 'none';
  }

  function createCopy(mirror) {
    const { owner } = mirror;
    // 클릭 전달·입력 전환용 번호. 원본에 먼저 달고 복제하면 사본의 같은 요소도 같은 번호를 갖는다.
    for (const el of owner.querySelectorAll(`${INTERACTIVE}, ${FORM_CONTROLS}`)) {
      if (!el.dataset.tfdRef) el.dataset.tfdRef = String(nextRef++);
    }
    const copy = owner.cloneNode(true);
    copy.removeAttribute('data-tfd-hidden');
    copy.classList.add('tfd-copy');
    // 원본을 숨기려고 붙인 display는 빼고, 원래 있던 값은 되살린다.
    if (mirror.display.value) copy.style.setProperty('display', mirror.display.value, mirror.display.priority);
    else copy.style.removeProperty('display');
    // :last-child 같은 위치 규칙이 사본에는 다르게 적용될 수 있어, 원본에 실제로 적용되던 위아래 여백을 그대로 쓴다.
    copy.style.marginTop = mirror.margins.top;
    copy.style.marginBottom = mirror.margins.bottom;
    for (const control of copy.querySelectorAll(FORM_CONTROLS)) {
      control.title = '클릭하면 원문 문단에서 입력할 수 있습니다';
    }
    if (peeking) copy.setAttribute('data-tfd-hidden', '');
    return copy;
  }

  function isOurs(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !!el && !!el.closest('.tfd-copy, #' + TFD.UI_HOST_ID);
  }

  function destroy(mirror) {
    TFD.forgetSentences(mirror.copy);
    mirror.copy.remove();
    if (mirror.owner.isConnected) unhide(mirror);
    mirrors.delete(mirror.owner);
  }

  /**
   * 원본 문단의 사본을 만들어 원본 앞에 두고 원본을 숨긴다.
   * @returns {{copy: Element, carried: object[]} | null} 숨기지 못하면 null.
   *   carried: 안쪽 문단 사본에서 번역해 두었던 문장들. 바깥 사본에서 다시 번역해야 한다.
   */
  function mirrorBlock(owner, deps) {
    const existing = mirrors.get(owner);
    if (existing) {
      existing.deps = deps;
      return { copy: existing.copy, carried: [] };
    }

    // 안쪽 문단에 이미 사본이 있으면 그 번역 상태를 기록해 두고 정리한 뒤, 바깥 문단 전체를 사본으로 만든다.
    const carried = [];
    for (const inner of [...mirrors.values()]) {
      if (!owner.contains(inner.owner)) continue;
      carried.push(...TFD.sentenceStates(inner.copy));
      destroy(inner);
    }

    const view = owner.ownerDocument.defaultView;
    const style = view.getComputedStyle(owner);
    const mirror = {
      owner,
      deps,
      version: 0,
      editing: false,
      display: { value: owner.style.getPropertyValue('display'), priority: owner.style.getPropertyPriority('display') },
      // 사본을 끼워 넣기 전에 읽어야 원본의 원래 위치 기준 여백이 나온다.
      margins: { top: style.marginTop, bottom: style.marginBottom },
    };
    mirror.copy = createCopy(mirror);
    owner.before(mirror.copy);
    hide(mirror);

    // 그래도 원본이 보이면(사이트가 강제로 표시) 사본을 거두고 이 문단은 번역하지 않는다.
    if (!isHidden(owner)) {
      mirror.copy.remove();
      unhide(mirror);
      return null;
    }

    mirrors.set(owner, mirror);
    byCopy.set(mirror.copy, mirror);
    startObserving();
    // 방금 우리가 한 DOM 변경은 감지 대상에서 뺀다.
    observer.takeRecords();
    return { copy: mirror.copy, carried };
  }

  /**
   * 우리가 하는 DOM 작업(사본 안 문장 감싸기·채우기 등)은 감시 기록에서 뺀다.
   * fn은 동기로 실행되므로 그동안 페이지가 DOM을 바꿀 수 없다. 작업 전에 쌓인 페이지 변화는 그대로 처리한다.
   * (빼지 않으면 문장마다 감시가 깨어나 모든 사본을 검사해서, 문장이 많을 때 크게 느려진다)
   */
  function quietly(fn) {
    if (!observer) return fn();
    const pending = observer.takeRecords();
    try {
      return fn();
    } finally {
      observer.takeRecords();
      if (pending.length) onMutations(pending);
    }
  }

  function startObserving() {
    if (observer) return;
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
    // 창 크기에 따라 여백이 달라지는 사이트가 있어, 크기 조절이 멈추면 사본 여백을 다시 맞춘다.
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => quietly(() => mirrors.forEach(refreshMargins)), RESIZE_SETTLE_MS);
    });
  }

  /**
   * 원본에 지금 적용되는 위아래 여백을 다시 읽어 사본에 적용한다.
   * 사본이 원본 앞에 있으면 :first-child, p + p 같은 규칙이 원본에 달라질 수 있어, 사본을 잠깐 떼어 내고 읽는다.
   * (동기로 처리해서 그사이 화면이 그려지지 않는다. 숨긴 원본도 여백 값은 그대로 계산된다)
   */
  function refreshMargins(mirror) {
    if (mirror.editing || !mirror.owner.isConnected) return;
    const { owner, copy } = mirror;
    const attached = copy.parentNode === owner.parentNode;
    if (attached) copy.remove();
    const style = owner.ownerDocument.defaultView.getComputedStyle(owner);
    mirror.margins = { top: style.marginTop, bottom: style.marginBottom };
    copy.style.marginTop = mirror.margins.top;
    copy.style.marginBottom = mirror.margins.bottom;
    if (attached) owner.before(copy);
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
        continue;
      }
      if (mirror.owner.previousSibling !== mirror.copy) mirror.owner.before(mirror.copy);
      // 페이지가 원본의 style을 다시 써서 숨김이 풀렸으면 다시 숨긴다.
      if (!peeking && !mirror.editing && mirror.owner.style.getPropertyValue('display') !== 'none') hide(mirror);
    }
    for (const mirror of changed) {
      // 원본에서 입력하는 중에는 사본을 다시 만들지 않고, 입력을 마칠 때 한 번에 다시 만든다.
      if (!mirror.editing) rebuild(mirror);
    }
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
   * 사본에서 다시 번역할 문장을 고른다.
   * 전에 번역했던 문장과 글자가 같은 문장, 그리고 글자가 바뀌었지만 단어가 절반 이상 겹치는 문장.
   */
  function pickTargets(candidates, previousTexts) {
    const plain = candidates.map(TFD.plainTextOf);
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

    // 원본 주변이 바뀌었을 수 있으니 여백을 사본 없이 다시 읽고 새 사본을 만든다.
    mirror.copy.remove();
    const style = mirror.owner.ownerDocument.defaultView.getComputedStyle(mirror.owner);
    mirror.margins = { top: style.marginTop, bottom: style.marginBottom };
    const copy = createCopy(mirror);
    mirror.owner.before(copy);
    mirror.copy = copy;
    byCopy.set(copy, mirror);
    if (!previous.length) return;

    const targets = pickTargets(TFD.collectSentences(null, copy), previous.map((p) => p.text));
    const deps = {
      translate: mirror.deps.backgroundTranslate || mirror.deps.translate,
      detector: mirror.deps.detector,
      store: mirror.deps.store,
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
    const el = e.target instanceof Element && e.target.closest(INTERACTIVE);
    const copy = el && el.dataset.tfdRef && el.closest('.tfd-copy');
    const mirror = copy && byCopy.get(copy);
    if (!mirror) return false;
    const original = mirror.owner.querySelector(`[data-tfd-ref="${el.dataset.tfdRef}"]`);
    if (!original) return false;
    e.preventDefault();
    e.stopPropagation();
    original.click();
    return true;
  }

  /*
   * 입력창: 사본에서는 입력을 막고, 누르거나 Tab으로 들어오면 그 문단만 원본을 보여 주고 원본 입력창에 커서를 둔다.
   * 원본 문단 밖으로 포커스가 나가면 사본을 새로 만들어(입력한 값이 보이도록) 다시 번역본을 보여 준다.
   */
  function onFormControlActivate(e) {
    const control = e.target instanceof Element && e.target.closest(FORM_CONTROLS);
    const copy = control && control.closest('.tfd-copy');
    const mirror = copy && byCopy.get(copy);
    if (!mirror || mirror.editing) return;
    e.preventDefault();
    e.stopPropagation();
    editInOriginal(mirror, control.dataset.tfdRef);
  }

  function editInOriginal(mirror, ref) {
    const original = ref && mirror.owner.querySelector(`[data-tfd-ref="${ref}"]`);
    if (!original) return;
    mirror.editing = true;
    unhide(mirror);
    mirror.copy.setAttribute('data-tfd-hidden', '');
    const onFocusOut = (e) => {
      if (mirror.owner.contains(e.relatedTarget)) return;
      mirror.owner.removeEventListener('focusout', onFocusOut);
      finishEditing(mirror);
    };
    mirror.owner.addEventListener('focusout', onFocusOut);
    original.focus();
    // 포커스를 줄 수 없는 경우(비활성 입력창 등)에는 바로 번역본으로 돌아간다.
    if (document.activeElement !== original) {
      mirror.owner.removeEventListener('focusout', onFocusOut);
      finishEditing(mirror);
    }
  }

  function finishEditing(mirror) {
    mirror.editing = false;
    if (!mirror.owner.isConnected) {
      destroy(mirror);
      return;
    }
    hide(mirror);
    rebuild(mirror);
  }

  /** 원본 보기: on이면 모든 사본을 숨기고 원본을 보여 준다. 원본의 툴팁·팝업 등 페이지 기능을 쓸 수 있다. */
  function peekOriginals(on) {
    if (peeking === on) return;
    peeking = on;
    for (const mirror of mirrors.values()) {
      if (mirror.editing) continue;
      if (on) {
        unhide(mirror);
        mirror.copy.setAttribute('data-tfd-hidden', '');
      } else {
        hide(mirror);
        mirror.copy.removeAttribute('data-tfd-hidden');
      }
    }
  }

  document.addEventListener('mousedown', onFormControlActivate, true);
  document.addEventListener('focusin', onFormControlActivate, true);

  TFD.mirrorMode = mirrorMode;
  TFD.mirrorBlock = mirrorBlock;
  TFD.pickTargets = pickTargets;
  TFD.forwardClick = forwardClick;
  TFD.peekOriginals = peekOriginals;
  TFD.quietly = quietly;
})(typeof globalThis !== 'undefined' ? globalThis : this);
