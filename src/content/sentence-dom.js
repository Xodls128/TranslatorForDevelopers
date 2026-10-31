/*
 * 선택 영역 번역 / 원문 ↔ 번역문 전환
 *
 * 번역: 선택 영역이 걸친 문장마다 원래 DOM 조각을 떼어 보관하고,
 *       그 자리에 번역문을 담은 <span class="tfd-sentence" data-tfd-id="n" data-tfd-state="translated">을 넣는다.
 *       주변 요소와 CSS는 그대로이므로 페이지 모양이 유지된다.
 * 전환: data-tfd-id(문장 번호)로 원문 조각과 번역문 조각을 모두 보관해 두고, span 안의 내용만 맞바꾼다.
 *       (data-tfd-state: translated | original)
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  const ATOM_RE = /[\ue000-\uf8ff]/g;
  // 문장 번호 → { original, translated }: 지금 화면에 없는 쪽의 DOM 조각(DocumentFragment)
  const stored = new Map();
  const cache = new Map(); // 보호 처리된 원문 → 번역문
  let nextId = 1;

  function findBlockAncestor(node) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const body = node.ownerDocument.body;
    while (el && el !== body) {
      const kind = TFD.classifyElement(el);
      if (kind === 'block' || kind === 'opaque') return el;
      el = el.parentElement;
    }
    return body;
  }

  // 두 Range가 글자 하나 이상 겹치는지
  function rangesIntersect(a, b) {
    return a.compareBoundaryPoints(Range.END_TO_START, b) < 0 && a.compareBoundaryPoints(Range.START_TO_END, b) > 0;
  }

  function isMostlyEnglish(text) {
    const plain = text.replace(ATOM_RE, '');
    const latin = (plain.match(/[A-Za-z]/g) || []).length;
    const hangul = (plain.match(/[가-힣]/g) || []).length;
    return latin > 0 && latin >= hangul;
  }

  /**
   * 선택 영역이 걸친 문장들을 문서 순서대로 찾는다.
   * @param {Range|null} selRange null이면 rootEl 안의 모든 영어 문장
   * @param {Element} [rootEl] 찾을 범위. 없으면 선택 영역을 감싸는 블록 요소
   */
  function collectSentences(selRange, rootEl = findBlockAncestor(selRange.commonAncestorContainer)) {
    const targets = [];
    for (const run of TFD.buildRuns(rootEl)) {
      for (const sentence of TFD.splitSentences(run.text)) {
        if (!isMostlyEnglish(sentence.text)) continue;
        const range = TFD.rangeForRun(run, sentence.start, sentence.end);
        if (selRange && !rangesIntersect(range, selRange)) continue;
        targets.push({
          text: sentence.text,
          range,
          atoms: run.atoms,
          positions: run.positions.slice(sentence.start, sentence.end),
          rootEl,
        });
      }
    }
    return targets;
  }

  /*
   * 강조 서식 유지
   * 번역문에서는 원문의 어느 단어가 어디로 갔는지 알 수 없으므로, 확실한 두 경우만 강조를 되살린다.
   * A. 문장의 글자(문장부호 제외)가 모두 같은 강조 요소 안에 있을 때 → 번역문 전체에 적용
   * B. 강조 요소 안이 보호 항목(용어, 코드 조각, <code> 등) 하나뿐일 때 → 그 항목에 적용
   */
  const EMPHASIS_TAGS = new Set(['strong', 'b', 'em', 'i', 'mark', 'u']);

  function isContentChar(ch) {
    return /[\p{L}\p{N}]/u.test(ch) || (ch >= '\ue000' && ch <= '\uf8ff');
  }

  // 글자 위치를 감싸는 강조 요소들 (안쪽 → 바깥쪽)
  function emphasisAncestors(pos, rootEl) {
    const list = [];
    for (let el = (pos.el || pos.node).parentElement; el && el !== rootEl; el = el.parentElement) {
      if (EMPHASIS_TAGS.has(el.localName)) list.push(el);
    }
    return list;
  }

  function commonEmphasis(positions, rootEl) {
    let common = null;
    for (const pos of positions) {
      const list = emphasisAncestors(pos, rootEl);
      common = common ? common.filter((el) => list.includes(el)) : list;
      if (common.length === 0) break;
    }
    return common || [];
  }

  // 문장 범위가 통째로 강조 요소 안에 있으면 번역문 span도 그 안에 들어가므로 다시 씌울 필요가 없다.
  function inheritsFrom(el, range) {
    return el.contains(range.startContainer) && el.contains(range.endContainer);
  }

  function sentenceEmphasis(target) {
    const positions = target.positions.filter((_, i) => isContentChar(target.text[i]));
    return commonEmphasis(positions, target.rootEl).filter((el) => !inheritsFrom(el, target.range));
  }

  function itemEmphasis(target, item, alreadyApplied) {
    const normalize = (s) => s.replace(/\s+/g, ' ').trim();
    const original = normalize(item.kind === 'atom' ? target.atoms[item.atomIndex].textContent : item.text);
    return commonEmphasis(target.positions.slice(item.start, item.end), target.rootEl).filter(
      (el) => !alreadyApplied.includes(el) && !inheritsFrom(el, target.range) && normalize(el.textContent) === original,
    );
  }

  // 강조 요소의 빈 복제본으로 감싼다. (elements: 안쪽 → 바깥쪽)
  function wrapWith(node, elements) {
    let wrapped = node;
    for (const el of elements) {
      const shell = el.cloneNode(false);
      shell.removeAttribute('id');
      shell.append(wrapped);
      wrapped = shell;
    }
    return wrapped;
  }

  /*
   * 링크 글자 번역
   * 문장 번역에서 링크는 통째로 보존(⟦n⟧)하고, 링크 글자만 따로 번역해 "한국어[원문]"으로 바꾼다.
   * API 이름·코드 링크(Promise, useState())와 <code> 등을 품은 링크는 영어 그대로 둔다.
   */
  const LONG_LINK_WORDS = 6; // 이보다 긴 링크는 병기 대신 원문 툴팁

  function translatableLinkText(el, detector) {
    if (el.localName !== 'a' || el.querySelector('code, kbd, samp, var, tt, img, svg, picture')) return null;
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    if (!/[A-Za-z]/.test(text) || /[가-힣]/.test(text)) return null;
    const spans = detector ? detector.detect(text) : [];
    const wholeIsTermOrCode = spans.length === 1 && spans[0].start === 0 && spans[0].end === text.length;
    return wholeIsTermOrCode ? null : text;
  }

  // 시간 초과와 사용자 취소는 번역 전체를 멈추는 신호다. 그 밖의 실패는 그 링크만 영어로 둔다.
  function isInterruption(err) {
    return !!err && (err.code === 'sentence-timeout' || err.code === 'cancelled');
  }

  async function translateCached(source, deps) {
    let translated = cache.get(source);
    if (translated === undefined) {
      translated = (await deps.translate(source)).trim();
      cache.set(source, translated);
    }
    return translated;
  }

  /** @returns {Promise<Map<object, {text: string, original: string, long: boolean}>>} 링크 항목 → 번역된 글자 */
  async function translateLinks(target, items, deps) {
    const labels = new Map();
    for (const item of items) {
      if (item.kind !== 'atom') continue;
      const original = translatableLinkText(target.atoms[item.atomIndex], deps.detector);
      if (!original) continue;

      const { source, items: inner } = TFD.protectSentence(original, deps.detector);
      let output;
      try {
        output = await translateCached(source, deps);
      } catch (err) {
        if (isInterruption(err)) throw err;
        continue;
      }
      const restored = TFD.restoreSentence(output, inner);
      if (!restored.ok) continue;
      let text = restored.parts.map((p) => (p.type === 'text' ? p.text : p.item.text)).join('').trim();
      // 명사구에 번역기가 붙인 마침표는 뗀다.
      if (!/[.!?]$/.test(original)) text = text.replace(/[.!?。]+$/, '');
      // 번역이 안 됐거나(영어 그대로) 원문과 같으면 병기하지 않고 원래 링크를 둔다.
      if (!/[가-힣]/.test(text) || text.toLowerCase() === original.toLowerCase()) continue;
      labels.set(item, { text, original, long: original.split(' ').length > LONG_LINK_WORDS });
    }
    return labels;
  }

  function applyLinkLabel(link, label) {
    link.textContent = label.text;
    if (label.long) {
      link.title = `원문: ${label.original}`;
      return;
    }
    const original = link.ownerDocument.createElement('span');
    original.className = 'tfd-link-original';
    original.textContent = `[${label.original}]`;
    link.append(original);
  }

  function renderParts(doc, parts, target, sentenceLevel) {
    const nodes = [];
    for (const part of parts) {
      if (part.type === 'text') {
        nodes.push(doc.createTextNode(part.text));
        continue;
      }
      const { item } = part;
      let node;
      if (item.kind === 'atom') {
        node = target.atoms[item.atomIndex].cloneNode(true);
        const label = target.linkLabels && target.linkLabels.get(item);
        if (label) applyLinkLabel(node, label);
      } else {
        node = doc.createElement('span');
        node.className = item.kind === 'term' ? 'tfd-term' : 'tfd-code';
        if (item.kind === 'term') node.dataset.term = item.term;
        node.textContent = item.text;
      }
      nodes.push(wrapWith(node, itemEmphasis(target, item, sentenceLevel)));
    }
    return nodes;
  }

  function replaceWithTranslation(target, parts) {
    const doc = target.range.startContainer.ownerDocument;
    const id = String(nextId++);
    const span = doc.createElement('span');
    span.className = 'tfd-sentence';
    span.dataset.tfdId = id;
    span.dataset.tfdState = 'translated';
    span.lang = 'ko';

    // 원래 DOM을 떼어 내기 전에 강조 요소를 찾아야 한다.
    const sentenceLevel = sentenceEmphasis(target);
    const content = doc.createDocumentFragment();
    content.append(...renderParts(doc, parts, target, sentenceLevel));
    span.append(wrapWith(content, sentenceLevel));

    const fragment = target.range.extractContents();
    target.range.insertNode(span);
    stored.set(id, { original: fragment, translated: null });
    return span;
  }

  // 문장 span의 내용을 보관해 둔 반대 상태(원문/번역문) 조각과 맞바꾼다.
  function swap(span, nextState) {
    const entry = stored.get(span.dataset.tfdId);
    const currentState = span.dataset.tfdState;
    if (!entry || currentState === nextState) return false;

    const current = span.ownerDocument.createDocumentFragment();
    current.append(...span.childNodes);
    entry[currentState] = current;
    span.append(entry[nextState]);
    entry[nextState] = null;

    span.dataset.tfdState = nextState;
    if (nextState === 'translated') {
      span.lang = 'ko';
      span.removeAttribute('title');
    } else {
      span.removeAttribute('lang');
      span.title = '클릭하면 번역문으로 돌아갑니다';
    }
    return true;
  }

  function spansInRange(selRange, state) {
    const doc = selRange.startContainer.ownerDocument;
    return Array.from(doc.querySelectorAll(`span.tfd-sentence[data-tfd-state="${state}"]`))
      .filter((span) => selRange.intersectsNode(span));
  }

  // 문장이 속한 문단(가장 가까운 블록 요소). 이미 우리 사본 안이면 null.
  function ownerBlock(target) {
    const first = target.positions[0];
    for (let el = (first.el || first.node).parentElement; el; el = el.parentElement) {
      if (TFD.classifyElement(el) === 'block') return el.closest('.tfd-copy') ? null : el;
    }
    return null;
  }

  // 원본 문단 안의 위치를 사본의 같은 위치로 옮긴다. (사본을 막 만든 직후라 구조가 같다)
  function mapPoint(node, offset, from, to) {
    const path = [];
    for (let n = node; n !== from; n = n.parentNode) path.unshift(Array.prototype.indexOf.call(n.parentNode.childNodes, n));
    let mapped = to;
    for (const i of path) mapped = mapped.childNodes[i];
    return [mapped, offset];
  }

  // 선택 영역 중 원본 문단에 걸친 부분을 사본 위의 Range로 바꾼다.
  function mapRangeToCopy(selRange, owner, copy) {
    const doc = owner.ownerDocument;
    const ownerRange = doc.createRange();
    ownerRange.selectNodeContents(owner);
    const range = doc.createRange();
    range.selectNodeContents(copy);
    if (ownerRange.comparePoint(selRange.startContainer, selRange.startOffset) === 0) {
      range.setStart(...mapPoint(selRange.startContainer, selRange.startOffset, owner, copy));
    }
    if (ownerRange.comparePoint(selRange.endContainer, selRange.endOffset) === 0) {
      range.setEnd(...mapPoint(selRange.endContainer, selRange.endOffset, owner, copy));
    }
    return range;
  }

  /*
   * 번역할 문장을 정한다.
   * 페이지가 관리하는 원본 문단은 건드리지 않고, 사본을 만들어(mirror.js) 사본 안의 같은 문장을 번역한다.
   * 이미 사본 안이거나 사본을 만들 수 없는 문단(입력창 포함 등)은 그 자리에서 번역한다.
   */
  function prepareTargets(selRange, deps) {
    const initial = collectSentences(selRange);
    // 사본을 만들면 원본이 숨김 처리되어 판정이 달라지므로, 문단은 사본을 만들기 전에 모두 정해 둔다.
    const ownerOf = initial.map(ownerBlock);
    const owners = [];
    for (const owner of ownerOf) {
      if (owner && TFD.canMirror(owner) && !owners.includes(owner)) owners.push(owner);
    }
    // 문단 안에 다른 문단이 있으면(목록 안의 목록 등) 바깥 문단 하나만 사본으로 만든다.
    const outermost = owners.filter((o) => !owners.some((p) => p !== o && p.contains(o)));

    const targets = [];
    const mirrored = new Set();
    for (const [i, target] of initial.entries()) {
      const owner = ownerOf[i];
      const top = owner && outermost.find((o) => o.contains(owner));
      if (!top) {
        targets.push(target);
        continue;
      }
      if (mirrored.has(top)) continue;
      mirrored.add(top);
      const copy = TFD.mirrorBlock(top, deps);
      targets.push(...collectSentences(mapRangeToCopy(selRange, top, copy), copy));
    }
    return targets;
  }

  /**
   * 문장들을 번역해서 화면에 반영한다.
   * @param {() => boolean} [isValid] 반영 직전에 확인. false면 반영하지 않는다. (그사이 사본이 바뀐 경우)
   */
  async function translateTargets(targets, deps, isValid = () => true) {
    const results = [];
    let interrupted = null;

    for (const target of targets) {
      const { source, items } = TFD.protectSentence(target.text, deps.detector);
      let translated;
      try {
        translated = await translateCached(source, deps);
        target.linkLabels = await translateLinks(target, items, deps);
      } catch (err) {
        interrupted = err;
        break;
      }
      // 번역된 링크 뒤의 조사는 한국어 링크 글자의 받침에 맞춘다.
      const displayText = (item) => {
        const label = target.linkLabels.get(item);
        return label && label.text;
      };
      results.push({ target, restored: TFD.restoreSentence(translated, items, displayText) });
    }

    // DOM은 뒤 문장부터 바꾼다. (앞 문장의 위치가 흔들리지 않도록)
    let failed = 0;
    const valid = isValid();
    for (let i = results.length - 1; i >= 0; i--) {
      const { target, restored } = results[i];
      if (!restored.ok) {
        failed++;
        continue;
      }
      if (valid) replaceWithTranslation(target, restored.parts);
    }
    return { done: results.length, failed, interrupted };
  }

  /**
   * @param {Range} selRange 사용자가 드래그한 영역
   * @param {{translate: (s: string) => Promise<string>, backgroundTranslate?: (s: string) => Promise<string>, detector: object}} deps
   *   backgroundTranslate: 페이지가 원본을 바꿔 사본을 다시 번역할 때 쓰는 번역 함수 (사용자 취소와 무관)
   * @returns {Promise<{translated: number, failed: number, remaining: number, interrupted: Error|null, scope: Range}>}
   *   interrupted: 번역이 중간에 멈춘 이유(시간 초과, 취소 등). 그 전에 끝난 문장은 화면에 반영된다.
   *   scope: 실제로 번역 대상이 된 범위. 원본 대신 사본을 번역했으면 사본 위의 범위다.
   */
  async function translateRange(selRange, deps) {
    // 원문으로 돌려 둔 문장은 보관해 둔 번역문으로 바로 되돌린다.
    let reshown = 0;
    for (const span of spansInRange(selRange, 'original')) if (swap(span, 'translated')) reshown++;

    const targets = prepareTargets(selRange, deps);
    const scope = scopeOf(targets, selRange);
    const { done, failed, interrupted } = await translateTargets(targets, deps);
    return {
      translated: done - failed + reshown,
      failed,
      remaining: targets.length - done,
      interrupted,
      scope,
    };
  }

  // 실제로 번역한 문장들(사본 안일 수 있음)을 감싸는 Range. "다시 시도"에 쓴다.
  // 살아 있는 Range라 그 안의 문장을 번역해 DOM이 바뀌어도 범위가 따라간다.
  function scopeOf(targets, fallback) {
    if (!targets.length) return fallback.cloneRange();
    const first = targets[0].range;
    const last = targets[targets.length - 1].range;
    const scope = first.startContainer.ownerDocument.createRange();
    scope.setStart(first.startContainer, first.startOffset);
    scope.setEnd(last.endContainer, last.endOffset);
    return scope;
  }

  const normalize = (s) => s.replace(/\s+/g, ' ').trim();

  // 번역 문장의 원문 글자 (상태와 관계없이)
  function originalText(span) {
    const entry = stored.get(span.dataset.tfdId);
    const source = span.dataset.tfdState === 'translated' && entry ? entry.original : span;
    return normalize(source.textContent);
  }

  /** root 안 번역 문장들의 원문 글자와 상태. 사본을 다시 만들 때 무엇을 다시 번역할지 정하는 데 쓴다. */
  function sentenceStates(root) {
    return Array.from(root.querySelectorAll('span.tfd-sentence')).map((span) => ({
      text: originalText(span),
      state: span.dataset.tfdState,
    }));
  }

  /** 원문 보기 상태였던 문장은 다시 만든 뒤에도 원문 보기로 돌려 둔다. */
  function applySentenceStates(root, states) {
    const originals = new Set(states.filter((s) => s.state === 'original').map((s) => s.text));
    for (const span of root.querySelectorAll('span.tfd-sentence[data-tfd-state="translated"]')) {
      if (originals.has(originalText(span))) swap(span, 'original');
    }
  }

  /** root 안 번역 문장들의 보관 데이터를 지운다. (사본을 버릴 때) */
  function forgetSentences(root) {
    for (const span of root.querySelectorAll('span.tfd-sentence')) stored.delete(span.dataset.tfdId);
  }

  /** 선택 영역에 걸친 번역 문장을 모두 원문으로 보여 주고, 바꾼 문장 수를 돌려준다. */
  function showOriginalInRange(selRange) {
    let count = 0;
    for (const span of spansInRange(selRange, 'translated')) if (swap(span, 'original')) count++;
    return count;
  }

  function touchesTranslation(selRange) {
    return spansInRange(selRange, 'translated').length > 0;
  }

  /** 원문 상태의 문장 span을 번역문으로 되돌린다. */
  function showTranslation(span) {
    return swap(span, 'translated');
  }

  TFD.collectSentences = collectSentences;
  TFD.translateTargets = translateTargets;
  TFD.translateRange = translateRange;
  TFD.sentenceStates = sentenceStates;
  TFD.applySentenceStates = applySentenceStates;
  TFD.forgetSentences = forgetSentences;
  TFD.normalizeText = normalize;
  TFD.showOriginalInRange = showOriginalInRange;
  TFD.touchesTranslation = touchesTranslation;
  TFD.showTranslation = showTranslation;
})(typeof globalThis !== 'undefined' ? globalThis : this);
