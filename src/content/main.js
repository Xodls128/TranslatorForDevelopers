/*
 * 사용자 동작 연결
 *
 * - 번역되지 않은 영어를 드래그하면 → 마우스 옆에 "번역" 버튼 표시 → 누르면 걸친 문장들을 번역
 * - 번역된 문장을 드래그하면 → 걸친 문장들을 바로 원문으로 전환 (단순 클릭/더블클릭으로는 바뀌지 않음)
 * - 원문으로 전환된 문장을 클릭하면 → 다시 번역문으로
 * - 번역문 속 개발 용어(점선 밑줄)를 클릭하면 → 검색 페이지를 새 탭으로 연다
 */
(function (root) {
  'use strict';

  const TFD = root.TFD;
  if (!TFD || TFD.started) return;
  TFD.started = true;

  const settings = { extraTerms: [], excludedTerms: [], searchEngine: 'google' };
  let detector = TFD.createTermDetector();
  // 이만큼 이상 끌어야 드래그로 본다. (클릭 중 손떨림으로 원문 전환되는 것을 막음)
  const DRAG_THRESHOLD_PX = 5;

  let pendingRange = null;
  let pointerDown = null;
  let busy = false;

  const ui = TFD.createUI({ onTranslate: handleTranslate });

  function applySettings(values) {
    Object.assign(settings, values);
    detector = TFD.createTermDetector({ extraTerms: settings.extraTerms, excludedTerms: settings.excludedTerms });
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(settings).then(applySettings).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const values = {};
      for (const [key, { newValue }] of Object.entries(changes)) if (key in settings) values[key] = newValue;
      applySettings(values);
    });
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
    pointerDown = ui.contains(e.target) ? null : { x: e.clientX, y: e.clientY };
  }

  function onSelectionDone(e) {
    if (busy || ui.contains(e.target)) return;
    const isMouse = e.type === 'mouseup';
    const dragged = isMouse
      ? !!pointerDown && Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) >= DRAG_THRESHOLD_PX
      : true;
    const point = isMouse ? { x: e.clientX, y: e.clientY } : null;
    pointerDown = null;

    // 선택 영역이 확정된 뒤에 읽는다.
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        ui.hideButton();
        return;
      }
      const range = sel.getRangeAt(0);
      if (isEditable(range.commonAncestorContainer)) return;

      if (TFD.touchesTranslation(range)) {
        // 번역문은 실제로 끌었을 때만 원문으로 바꾼다. 더블클릭 단어 선택 등은 무시한다.
        if (dragged && TFD.showOriginalInRange(range) > 0) sel.removeAllRanges();
        ui.hideButton();
        return;
      }
      if (!/[A-Za-z]/.test(sel.toString())) {
        ui.hideButton();
        return;
      }
      pendingRange = range.cloneRange();
      ui.showButton(point || selectionEndPoint(range));
    }, 0);
  }

  function errorMessage(err) {
    if (err instanceof TFD.TranslatorUnavailableError) {
      return err.reason === 'unsupported'
        ? '이 브라우저는 내장 번역 기능(Translator API)을 지원하지 않습니다. 데스크톱 Chrome 138 이상이 필요합니다.'
        : '이 기기에서는 영어→한국어 내장 번역을 사용할 수 없습니다.';
    }
    return `번역 중 오류가 발생했습니다: ${err && err.message ? err.message : err}`;
  }

  async function handleTranslate() {
    const range = pendingRange;
    pendingRange = null;
    ui.hideButton();
    if (!range || busy) return;

    busy = true;
    // 사용자 동작이 유지되는 동안 바로 호출해야 언어팩 다운로드가 허용된다.
    const translatorReady = TFD.getTranslator((loaded) => {
      ui.showToast(`번역 모델 다운로드 중… ${Math.round(loaded * 100)}%`, { duration: 0 });
    });
    ui.showToast('번역 중…', { duration: 0 });

    try {
      const translator = await translatorReady;
      const result = await TFD.translateRange(range, {
        translate: (text) => translator.translate(text),
        detector,
      });
      window.getSelection().removeAllRanges();
      if (result.failed > 0) {
        ui.showToast(`${result.translated}문장 번역, ${result.failed}문장은 용어 보호 처리에 실패해 원문으로 두었습니다.`);
      } else if (result.translated === 0) {
        ui.showToast('번역할 영어 문장을 찾지 못했습니다.');
      } else {
        ui.showToast(`${result.translated}문장을 번역했습니다. 번역된 부분을 드래그하면 원문으로 돌아갑니다.`);
      }
    } catch (err) {
      ui.showToast(errorMessage(err), { type: 'error', duration: 6000 });
    } finally {
      busy = false;
    }
  }

  function onClick(e) {
    if (!(e.target instanceof Element)) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;

    const term = e.target.closest('.tfd-term');
    if (term) {
      e.preventDefault();
      e.stopPropagation();
      const query = TFD.buildSearchQuery(term.dataset.term || term.textContent);
      window.open(TFD.buildSearchUrl(query, settings.searchEngine), '_blank', 'noopener');
      return;
    }

    // 원문으로 전환된 문장을 클릭하면 번역문으로 되돌린다. (문장 안 링크 클릭은 그대로 둔다)
    const sentence = e.target.closest('.tfd-sentence[data-tfd-state="original"]');
    if (sentence && !e.target.closest('a')) TFD.showTranslation(sentence);
  }

  document.addEventListener('mousedown', onPointerDown, true);
  document.addEventListener('mouseup', onSelectionDone, true);
  document.addEventListener('keyup', (e) => {
    if (e.shiftKey || e.key === 'Shift') onSelectionDone(e);
  }, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') ui.hideButton();
  });
  window.addEventListener('scroll', () => ui.hideButton(), { passive: true, capture: true });
})(typeof globalThis !== 'undefined' ? globalThis : this);
