/*
 * 사용자 동작 연결
 *
 * - 번역되지 않은 영어를 드래그하면 → 마우스 옆에 "번역" 버튼 표시 → 누르면 걸친 문장들을 번역
 * - 번역된 문장을 클릭하면 → 그 문장을 원문으로, 다시 클릭하면 번역문으로 (더블클릭으로는 바뀌지 않음)
 * - 번역된 문장들을 드래그하면 → "원문 보기" 버튼 표시 → 누르면 걸친 문장들을 모두 원문으로 (누르지 않으면 그냥 선택·복사)
 * - 번역문 속 개발 용어(점선 밑줄)를 클릭하면 → 검색 페이지를 새 탭으로 연다
 */
(function (root) {
  'use strict';

  const TFD = root.TFD;
  if (!TFD || TFD.started) return;
  TFD.started = true;

  const settings = {
    extraTerms: [],
    excludedTerms: [],
    searchEngine: 'google',
    saveTranslations: true,
    packsAuto: true, // 사이트에 맞춰 분야 묶음 켜기 (src/data/sites.js)
    packsAlways: [], // 모든 사이트에서 켤 분야 묶음
    koreanEdition: true, // 공식 한국어판이 있으면 첫 번역 결과와 함께 알려 주기
  };
  // 이 페이지 주소에 맞는 분야 묶음과 검색 맥락
  const currentSite = () => TFD.resolveSite(location.hostname, location.pathname);
  const hasChromeStorage = typeof chrome !== 'undefined' && !!chrome.storage;
  // 이만큼 이상 끌어야 드래그로 본다. (클릭 중 손떨림으로 원문 전환되는 것을 막음)
  const DRAG_THRESHOLD_PX = 5;

  let pendingRange = null;
  let pendingMode = 'translate'; // 버튼이 할 일: 'translate'(번역) 또는 'original'(번역문을 원문으로)
  let lastRange = null; // 안내 카드의 "다시 시도"에 쓰는 직전 번역 영역
  let pointerDown = null;
  let busy = false; // 번역 진행 중. 새 번역 시작만 막고, 원문 전환·용어 검색은 계속 된다.

  /*
   * 단계별 초기화: 번역을 쓰지 않는 페이지에서는 이벤트 리스너만 등록한다.
   *   페이지 열기      → 이벤트 리스너 (이 파일 맨 아래)
   *   처음 영어 드래그 → prepare(): 버튼 UI, 번역 기록 저장소, 저장된 설정 읽기, 번역기 가용성 확인
   *   버튼에 마우스    → 모델이 이미 있으면 번역기를 미리 만든다 (translator.js)
   *   버튼 클릭        → 용어 감지기가 없으면 만든다 (getDetector) → 번역
   */
  let ui = null;
  let store = null; // 번역 결과 기기 저장소. 확장 전용 공간(chrome.storage.local)이라 웹사이트는 읽을 수 없다.
  let settingsReady = Promise.resolve();
  let detector = null; // 처음 번역할 때 만들고, 설정이 바뀌면 비워 두었다가 다음 번역 때 다시 만든다.

  function prepare() {
    if (ui) return;
    ui = TFD.createUI({ onTranslate: handleTranslate, onButtonHover: () => pendingMode === 'translate' && TFD.prewarmTranslator() });
    store = TFD.createTranslationStore({
      storage: hasChromeStorage ? chrome.storage.local : null,
      enabled: () => settings.saveTranslations,
    });
    if (hasChromeStorage && chrome.storage.sync) {
      settingsReady = chrome.storage.sync.get({ ...settings }).then(applySettings).catch(() => {});
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        const values = {};
        for (const [key, { newValue }] of Object.entries(changes)) if (key in settings) values[key] = newValue;
        applySettings(values);
      });
    }
    TFD.checkTranslator();
  }

  const hideButton = () => ui && ui.hideButton();

  function buildDetector() {
    const packs = new Set(settings.packsAlways);
    if (settings.packsAuto) for (const name of currentSite().packs) packs.add(name);
    return TFD.createTermDetector({ extraTerms: settings.extraTerms, excludedTerms: settings.excludedTerms, packs: [...packs] });
  }

  function getDetector() {
    if (!detector) detector = buildDetector();
    return detector;
  }

  function applySettings(values) {
    Object.assign(settings, values);
    detector = null;
  }

  function isEditable(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !!el && (el.isContentEditable || !!el.closest('input, textarea'));
  }

  // 키보드로 선택했을 때는 선택 영역 끝을 버튼 위치로 쓴다.
  function selectionEndPoint(range) {
    const rects = range.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    return { x: rect.right, y: rect.bottom };
  }

  function onPointerDown(e) {
    pointerDown = ui && ui.contains(e.target) ? null : { x: e.clientX, y: e.clientY };
  }

  /**
   * 열린 Shadow DOM 안(MDN 코드 예제 등)을 드래그하면 document의 선택 범위는 바깥에 접힌 빈 범위로 보인다.
   * 이벤트 경로의 Shadow root를 넘겨 그 안의 실제 범위를 얻는다. 없으면 null.
   */
  function shadowRange(sel, roots) {
    if (!roots.length || typeof sel.getComposedRanges !== 'function') return null;
    let ranges;
    try {
      ranges = sel.getComposedRanges({ shadowRoots: roots });
    } catch {
      return null;
    }
    const r = ranges && ranges[0];
    if (!r || r.collapsed || !(r.startContainer.getRootNode() instanceof ShadowRoot)) return null;
    const range = document.createRange();
    range.setStart(r.startContainer, r.startOffset);
    range.setEnd(r.endContainer, r.endOffset);
    return range;
  }

  function onSelectionDone(e) {
    if (ui && ui.contains(e.target)) return;
    // Shadow DOM 안의 선택을 읽으려면 이벤트가 지나간 Shadow root가 필요하다. (이벤트가 끝나면 경로를 얻을 수 없음)
    const shadowRoots = e.composedPath().filter((node) => node instanceof ShadowRoot);
    const isMouse = e.type === 'mouseup';
    const dragged = isMouse
      ? !!pointerDown && Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) >= DRAG_THRESHOLD_PX
      : true;
    const point = isMouse ? { x: e.clientX, y: e.clientY } : null;
    pointerDown = null;

    // 선택 영역이 확정된 뒤에 읽는다.
    setTimeout(() => {
      const sel = window.getSelection();
      const range = (sel && shadowRange(sel, shadowRoots)) || (sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0) : null);
      if (!range || range.collapsed) {
        hideButton();
        return;
      }
      if (isEditable(range.commonAncestorContainer)) return;

      if (TFD.touchesTranslation(range)) {
        // 번역문을 드래그하면 "원문 보기" 버튼만 띄운다. 누르지 않으면 그냥 선택이라 복사할 수 있다.
        // (더블클릭 단어 선택처럼 끌지 않은 선택에는 띄우지 않는다)
        if (!dragged) {
          hideButton();
          return;
        }
        pendingRange = range.cloneRange();
        pendingMode = 'original';
        prepare();
        ui.showButton(point || selectionEndPoint(range), '원문 보기');
        return;
      }
      if (TFD.inHeading(range.commonAncestorContainer)) {
        if (dragged && !busy) {
          prepare();
          ui.showToast('제목은 번역하지 않습니다.', { duration: 2000 });
        }
        hideButton();
        return;
      }
      // 코드 블록 안에서만 드래그했으면 그 줄들의 주석만 번역한다. (문단과 같이 드래그하면 코드 블록은 건드리지 않음)
      const codeBlock = TFD.codeBlockOf(range);
      if (busy || !/[A-Za-z]/.test(range.toString()) || (codeBlock && !TFD.hasCommentsToTranslate(codeBlock, range))) {
        hideButton();
        return;
      }
      pendingRange = range.cloneRange();
      pendingMode = 'translate';
      prepare();
      ui.showButton(point || selectionEndPoint(range), '번역');
    }, 0);
  }

  // 실패 원인을 안내 카드로 보여 준다. 다시 시도하면 직전 영역으로 처음부터 번역한다.
  function showFailure(code, info) {
    const detail = info.cause ? `${info.cause.name || 'Error'}: ${info.cause.message || info.cause}` : null;
    const stallSeconds = Math.round(TFD.TRANSLATOR_TIMEOUTS.downloadStallMs / 1000);
    ui.showCard(TFD.describeError(code, { ...info, stallSeconds, detail }), {
      onRetry: () => {
        pendingRange = lastRange;
        pendingMode = 'translate';
        handleTranslate();
      },
    });
  }

  function report(result) {
    const err = result.interrupted;
    if (err) {
      const code = err instanceof TFD.TranslatorError ? err.code : 'unknown';
      if (code === 'cancelled') {
        ui.showToast(`번역을 취소했습니다. ${result.translated}문장은 번역을 마쳤습니다.`);
      } else {
        showFailure(code, { translated: result.translated, remaining: result.remaining, cause: err.cause || err });
      }
    } else if (result.failed > 0) {
      showFailure('protect-failed', { translated: result.translated, failed: result.failed });
    } else if (result.translated === 0 && result.rebuilt > 0) {
      ui.showToast('번역하는 동안 페이지 내용이 바뀌어, 바뀐 문단을 새로 번역했습니다.');
    } else if (result.translated === 0 && result.skipped > 0) {
      ui.showToast(`${SKIPPED_NOTE(result.skipped)}`, { duration: 5000 });
    } else if (result.translated === 0) {
      ui.showToast(result.unit === 'comment' ? '번역할 영어 주석을 찾지 못했습니다.' : '번역할 영어 문장을 찾지 못했습니다.');
    } else if (result.unit === 'comment') {
      showDone(`주석 ${result.translated}개를 번역했습니다. 번역된 문장을 클릭하면 원문으로 바뀝니다.`);
    } else if (result.skipped > 0) {
      showDone(`${result.translated}문장을 번역했습니다. ${SKIPPED_NOTE(result.skipped)}`, 5000);
    } else {
      showDone(`${result.translated}문장을 번역했습니다. 번역된 문장을 클릭하면 원문으로 바뀝니다.`);
    }
  }

  // 공식 한국어판 안내: 페이지 주소마다 한 번, 첫 번역 결과와 함께 보여 준다.
  // (React 등에서 페이지를 새로 불러오지 않고 문서를 옮겨 다녀도 주소가 바뀌면 다시 안내)
  const koreanEditionShown = new Set();
  function koreanEditionLink() {
    if (!settings.koreanEdition) return null;
    const page = location.href.split('#')[0];
    if (koreanEditionShown.has(page)) return null;
    koreanEditionShown.add(page);
    const href = TFD.findKoreanEdition(document);
    return href ? { label: '한국어판 열기', href } : null;
  }
  const KOREAN_EDITION_NOTE = ' 이 문서는 공식 한국어판이 있습니다. (영어판보다 갱신이 늦을 수 있음)';

  // 번역을 마친 알림. 공식 한국어판이 있으면 링크를 덧붙이고 더 오래 보여 준다.
  function showDone(message, duration) {
    const link = koreanEditionLink();
    if (link) ui.showToast(message + KOREAN_EDITION_NOTE, { duration: 8000, link });
    else ui.showToast(message, duration ? { duration } : undefined);
  }

  const SKIPPED_NOTE = (n) => `${n}문장은 동영상·그림·삽입된 페이지가 있는 문단이라 번역하지 않았습니다.`;

  async function handleTranslate() {
    const range = pendingRange;
    pendingRange = null;
    ui.hideButton();
    // "원문 보기" 버튼: 걸친 번역문들을 원문으로 바꾼다. (번역 중에도 된다)
    if (pendingMode === 'original') {
      if (range && TFD.showOriginalInRange(range) > 0) window.getSelection().removeAllRanges();
      return;
    }
    if (!range || busy) return;

    busy = true;
    lastRange = range.cloneRange();
    const job = new AbortController();
    const showStatus = (message) => ui.showToast(message, { duration: 0, onCancel: () => job.abort() });

    // 사용자 동작이 유지되는 동안 바로 호출해야 언어팩 다운로드가 허용된다.
    const translatorReady = TFD.getTranslator({
      signal: job.signal,
      onProgress: (loaded) => showStatus(`번역 모델 다운로드 중… ${Math.round(loaded * 100)}%`),
    });
    showStatus('번역 중…');

    try {
      const translator = await translatorReady;
      await settingsReady; // 처음 드래그 때 읽기 시작한 설정 (보통 이미 와 있음)
      const translateFn = TFD.codeBlockOf(range) ? TFD.translateCodeComments : TFD.translateRange;
      const result = await translateFn(range, {
        translate: (text) => TFD.translateText(translator, text, job.signal),
        // 페이지가 원본 문단을 바꿔 사본을 다시 번역할 때 쓴다. 이번 작업의 취소와는 무관하다.
        backgroundTranslate: (text) => TFD.translateText(translator, text),
        detector: getDetector(),
        store,
      });
      window.getSelection().removeAllRanges();
      // 원본 문단 대신 사본을 번역했을 수 있으므로, 다시 시도할 범위는 실제로 번역한 범위로 바꾼다.
      lastRange = result.scope;
      report(result);
    } catch (err) {
      // 번역기를 만들지 못한 경우. getTranslator가 상태를 비워 두므로 다음 클릭에서 새로 시도한다.
      const code = err instanceof TFD.TranslatorError ? err.code : 'unknown';
      if (code === 'cancelled') ui.showToast('번역을 취소했습니다.');
      else showFailure(code, { cause: err.cause || err });
    } finally {
      busy = false;
    }
  }

  // 문장 클릭 전환은 잠깐 기다렸다가 한다. 그사이 두 번째 클릭이 오면 더블클릭(단어 선택)이라 전환하지 않는다.
  const CLICK_DELAY_MS = 300;
  let pendingToggle = null;
  function cancelPendingToggle() {
    clearTimeout(pendingToggle);
    pendingToggle = null;
  }

  function scheduleToggle(sentence) {
    cancelPendingToggle();
    pendingToggle = setTimeout(() => {
      pendingToggle = null;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return; // 그사이 글자를 선택했으면 전환하지 않는다
      if (sentence.dataset.tfdState === 'translated') TFD.showOriginal(sentence);
      else if (sentence.dataset.tfdState === 'original') TFD.showTranslation(sentence);
    }, CLICK_DELAY_MS);
  }

  function onClick(e) {
    // 더블클릭·세 번 클릭(단어·문단 선택)이면 기다리던 전환을 취소한다.
    if (e.detail > 1) {
      cancelPendingToggle();
      return;
    }
    // Shadow DOM 안에서 클릭하면 e.target은 바깥 요소로 바뀌어 보이므로, 실제로 누른 요소를 쓴다.
    const target = e.composedPath()[0];
    if (!(target instanceof Element)) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;

    const term = target.closest('.tfd-term');
    if (term) {
      e.preventDefault();
      e.stopPropagation();
      const query = TFD.buildSearchQuery(term.dataset.term || term.textContent, { topic: currentSite().topic });
      window.open(TFD.buildSearchUrl(query, settings.searchEngine), '_blank', 'noopener');
      return;
    }

    // 번역문을 클릭하면 원문으로, 원문을 클릭하면 번역문으로. (문장 안 링크 클릭은 링크 동작을 우선한다)
    const sentence = target.closest('.tfd-sentence[data-tfd-state="translated"], .tfd-sentence[data-tfd-state="original"]');
    if (sentence && !target.closest('a')) {
      scheduleToggle(sentence);
      return;
    }

    // 문단 사본 안의 링크·버튼은 원본의 같은 요소로 클릭을 전달한다. (React 등 페이지 동작 유지)
    TFD.forwardClick(e);
  }

  document.addEventListener('mousedown', onPointerDown, true);
  document.addEventListener('mouseup', onSelectionDone, true);
  // Shift+방향키처럼 선택을 실제로 움직이는 키를 뗐을 때만 키보드 선택으로 본다.
  // Shift만 눌렀다 떼는 것은 원본 보기 동작이라, 남아 있던 선택(더블클릭 등)을 건드리지 않는다.
  const SELECTION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
  document.addEventListener('keyup', (e) => {
    if (e.shiftKey && SELECTION_KEYS.has(e.key)) onSelectionDone(e);
  }, true);
  document.addEventListener('click', onClick, true);

  // Shift를 단독으로 0.3초 이상 누르고 있는 동안 원본 보기.
  // 대문자 입력·Shift+방향키·Shift+클릭과 겹치지 않도록 잠깐 기다렸다가 켜고,
  // 다른 키나 마우스를 누르면 바로 끝내며, 입력창에 커서가 있을 때는 동작하지 않는다.
  const PEEK_DELAY_MS = 300;
  let peeking = false;
  let peekTimer = null;
  function setPeek(on) {
    if (peeking === on) return;
    peeking = on;
    TFD.peekOriginals(on);
  }
  function cancelPeek() {
    clearTimeout(peekTimer);
    peekTimer = null;
    setPeek(false);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideButton();
    if (e.key !== 'Shift') {
      cancelPeek();
      return;
    }
    if (e.repeat || peekTimer || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditable(document.activeElement || document.body)) return;
    peekTimer = setTimeout(() => setPeek(true), PEEK_DELAY_MS);
  }, true);
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') cancelPeek();
  }, true);
  document.addEventListener('mousedown', cancelPeek, true);
  // 다른 창으로 가면 keyup이 오지 않으므로 여기서 끝낸다.
  window.addEventListener('blur', cancelPeek);
  window.addEventListener('scroll', hideButton, { passive: true, capture: true });
  // 탭을 닫거나 다른 탭으로 갈 때 모아 둔 번역을 바로 기록한다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && store) store.flush();
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
