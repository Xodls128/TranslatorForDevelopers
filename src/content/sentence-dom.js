/*
 * 선택 영역 번역 / 원문 복원
 *
 * 번역: 선택 영역이 걸친 문장마다 원래 DOM 조각을 떼어 보관하고,
 *       그 자리에 번역문을 담은 <span class="tfd-sentence" data-tfd-id="n">을 넣는다.
 *       주변 요소와 CSS는 그대로이므로 페이지 모양이 유지된다.
 * 복원: data-tfd-id(문장 번호)로 보관해 둔 원래 DOM 조각을 다시 끼워 넣는다.
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  const ATOM_RE = /[\ue000-\uf8ff]/g;
  const originals = new Map(); // 문장 번호 → 원래 DOM 조각(DocumentFragment)
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

  /** 선택 영역이 걸친 문장들을 문서 순서대로 찾는다. */
  function collectSentences(selRange) {
    const rootEl = findBlockAncestor(selRange.commonAncestorContainer);
    const targets = [];
    for (const run of TFD.buildRuns(rootEl)) {
      for (const sentence of TFD.splitSentences(run.text)) {
        if (!isMostlyEnglish(sentence.text)) continue;
        const range = TFD.rangeForRun(run, sentence.start, sentence.end);
        if (!rangesIntersect(range, selRange)) continue;
        targets.push({ text: sentence.text, range, atoms: run.atoms });
      }
    }
    return targets;
  }

  function renderParts(doc, parts, atoms) {
    const nodes = [];
    for (const part of parts) {
      if (part.type === 'text') {
        nodes.push(doc.createTextNode(part.text));
        continue;
      }
      const { item } = part;
      if (item.kind === 'atom') {
        nodes.push(atoms[item.atomIndex].cloneNode(true));
      } else {
        const span = doc.createElement('span');
        span.className = item.kind === 'term' ? 'tfd-term' : 'tfd-code';
        if (item.kind === 'term') span.dataset.term = item.term;
        span.textContent = item.text;
        nodes.push(span);
      }
    }
    return nodes;
  }

  function replaceWithTranslation(target, parts) {
    const doc = target.range.startContainer.ownerDocument;
    const id = String(nextId++);
    const span = doc.createElement('span');
    span.className = 'tfd-sentence';
    span.dataset.tfdId = id;
    span.lang = 'ko';
    span.append(...renderParts(doc, parts, target.atoms));

    const fragment = target.range.extractContents();
    target.range.insertNode(span);
    originals.set(id, fragment);
    return span;
  }

  /**
   * @param {Range} selRange 사용자가 드래그한 영역
   * @param {{translate: (s: string) => Promise<string>, detector: object}} deps
   * @returns {Promise<{translated: number, failed: number}>}
   */
  async function translateRange(selRange, deps) {
    const targets = collectSentences(selRange);
    const results = [];

    for (const target of targets) {
      const { source, items } = TFD.protectSentence(target.text, deps.detector);
      let translated = cache.get(source);
      if (translated === undefined) {
        translated = (await deps.translate(source)).trim();
        cache.set(source, translated);
      }
      results.push({ target, restored: TFD.restoreSentence(translated, items) });
    }

    // DOM은 뒤 문장부터 바꾼다. (앞 문장의 위치가 흔들리지 않도록)
    let failed = 0;
    for (let i = results.length - 1; i >= 0; i--) {
      const { target, restored } = results[i];
      if (!restored.ok) {
        failed++;
        continue;
      }
      replaceWithTranslation(target, restored.parts);
    }
    return { translated: results.length - failed, failed };
  }

  function restoreSentence(span) {
    const fragment = originals.get(span.dataset.tfdId);
    if (!fragment) return false;
    originals.delete(span.dataset.tfdId);
    const parent = span.parentNode;
    span.replaceWith(fragment);
    parent.normalize();
    return true;
  }

  /** 선택 영역에 걸친 번역 문장을 모두 원문으로 되돌리고, 되돌린 문장 수를 돌려준다. */
  function restoreInRange(selRange) {
    const doc = selRange.startContainer.ownerDocument;
    const spans = Array.from(doc.querySelectorAll('span.tfd-sentence')).filter((s) => selRange.intersectsNode(s));
    let count = 0;
    for (const span of spans) if (restoreSentence(span)) count++;
    return count;
  }

  TFD.collectSentences = collectSentences;
  TFD.translateRange = translateRange;
  TFD.restoreInRange = restoreInRange;
})(typeof globalThis !== 'undefined' ? globalThis : this);
