/*
 * 선택 영역 번역 / 원문 ↔ 번역문 전환
 *
 * 대상: 페이지가 관리하는 원본 문단은 건드리지 않고, 문단 사본(mirror.js)을 만들어 사본 안의 같은 문장을 번역한다.
 *       이미 사본 안이거나 문서 최상위 글자는 그 자리에서, 복제할 수 없는 문단(동영상·캔버스 등)은 번역하지 않는다.
 * 번역: ① 대상 문장마다 <span class="tfd-sentence" data-tfd-state="pending">으로 감싼다. (안에는 원문 그대로)
 *       ② 읽는 순서대로 번역하며, 끝나는 문장부터 그 span 안의 내용만 번역문으로 바꾼다. (data-tfd-state="translated")
 *       취소·시간 초과·토큰 깨짐이면 대기 중인 span을 걷어 내 원문을 제자리에 되돌린다.
 *       링크 글자는 따로 번역해 "한국어[원문]"으로, 강조 서식은 확실한 경우만 되살린다.
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

  // 위치 계산용 Range는 하나만 만들어 재사용한다.
  // 살아 있는 Range가 많으면 DOM이 바뀔 때마다 브라우저가 전부 갱신해야 해서, 문장이 많을 때 크게 느려진다.
  let scratch = null;
  function scratchRange(doc) {
    if (!scratch || scratch.startContainer.ownerDocument !== doc) scratch = doc.createRange();
    return scratch;
  }

  /**
   * 선택 영역이 걸친 문장들을 문서 순서대로 찾는다. Range 대신 글자 위치 정보를 담는다.
   * @param {Range|null} selRange null이면 rootEl 안의 모든 영어 문장
   * @param {Element} [rootEl] 찾을 범위. 없으면 선택 영역을 감싸는 블록 요소
   */
  function collectSentences(selRange, rootEl = findBlockAncestor(selRange.commonAncestorContainer)) {
    const targets = [];
    if (TFD.inHeading(rootEl)) return targets; // 제목은 번역하지 않는다.
    const range = scratchRange(rootEl.ownerDocument);
    for (const run of TFD.buildRuns(rootEl)) {
      for (const sentence of TFD.splitSentences(run.text)) {
        if (!isMostlyEnglish(sentence.text)) continue;
        if (selRange && !rangesIntersect(TFD.setRangeForRun(range, run, sentence.start, sentence.end), selRange)) continue;
        targets.push({
          text: sentence.text,
          run,
          start: sentence.start,
          end: sentence.end,
          atoms: run.atoms,
          positions: run.positions.slice(sentence.start, sentence.end),
          rootEl,
        });
      }
    }
    return targets;
  }

  /** 문장의 보이는 글자 (요소 자리는 그 요소의 글자로). 사본을 다시 만들 때 같은 문장인지 비교하는 데 쓴다. */
  function plainTextOf(target) {
    const text = target.text.replace(ATOM_RE, (ch) => target.atoms[ch.charCodeAt(0) - 0xe000].textContent);
    return normalize(text);
  }

  // 문장 범위의 시작·끝 경계가 놓인 노드
  const startContainerOf = (target) => TFD.startPoint(target.positions[0])[0];
  const endContainerOf = (target) => TFD.endPoint(target.positions[target.positions.length - 1])[0];

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
  function inheritsFrom(el, target) {
    return el.contains(startContainerOf(target)) && el.contains(endContainerOf(target));
  }

  function sentenceEmphasis(target) {
    const positions = target.positions.filter((_, i) => isContentChar(target.text[i]));
    return commonEmphasis(positions, target.rootEl).filter((el) => !inheritsFrom(el, target));
  }

  function itemEmphasis(target, item, alreadyApplied) {
    const original = normalize(item.kind === 'atom' ? target.atoms[item.atomIndex].textContent : item.text);
    return commonEmphasis(target.positions.slice(item.start, item.end), target.rootEl).filter(
      (el) => !alreadyApplied.includes(el) && !inheritsFrom(el, target) && normalize(el.textContent) === original,
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

  /*
   * 번역 결과 찾기: ① 메모리(이 탭) → ② 기기 저장소(deps.store, 껐다 켜도 남음) → ③ 번역기
   * 번역기로 새로 번역한 결과는 화면에 반영할 수 있을 때(토큰 복원 성공)만 기기 저장소에 기록한다.
   */
  const fresh = new Set(); // 번역기로 새로 번역했지만 아직 기기에 기록하지 않은 입력

  async function translateCached(source, deps) {
    let translated = cache.get(source);
    if (translated !== undefined) return translated;
    if (deps.store) {
      translated = (await deps.store.getMany([source])).get(source);
      if (translated !== undefined) {
        cache.set(source, translated);
        return translated;
      }
    }
    translated = (await deps.translate(source)).trim();
    cache.set(source, translated);
    fresh.add(source);
    return translated;
  }

  // 토큰 복원까지 성공한 번역만 기기에 기록한다. (실패한 결과는 다시 시도해도 같아서 저장할 가치가 없음)
  function remember(source, deps) {
    if (!fresh.has(source)) return;
    fresh.delete(source);
    if (deps.store) deps.store.put(source, cache.get(source));
  }

  // 번역 전에 대상 문장들을 기기 저장소에서 한 번에 찾아 메모리에 올려 둔다. (문장마다 따로 조회하지 않도록)
  async function prefetch(jobs, deps) {
    if (!deps.store) return;
    const missing = jobs.map((job) => job.source).filter((source) => !cache.has(source));
    for (const [source, translated] of await deps.store.getMany(missing)) cache.set(source, translated);
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
      remember(source, deps);
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

  function renderParts(doc, parts, job) {
    const { target } = job;
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
      nodes.push(wrapWith(node, job.itemLevel.get(item)));
    }
    return nodes;
  }

  /**
   * ① 감싸기: 대상 문장마다 "번역 중" span으로 감싼다. 안에는 원문이 그대로 보인다.
   * 앞 문장의 위치 정보가 틀어지지 않도록 뒤 문장부터 감싸고, 작업용 Range는 하나만 쓴다.
   * 보호 처리와 강조 판단처럼 원래 위치가 필요한 계산은 감싸기 전에 미리 해 둔다.
   * @returns {object[]} 문서 순서의 작업 목록
   */
  function wrapPending(targets, detector) {
    return quietly(() => wrapAll(targets, detector));
  }

  function wrapAll(targets, detector) {
    const jobs = new Array(targets.length);
    for (let i = targets.length - 1; i >= 0; i--) {
      const target = targets[i];
      const { source, items } = TFD.protectSentence(target.text, detector);
      const sentenceLevel = sentenceEmphasis(target);
      const itemLevel = new Map(items.map((item) => [item, itemEmphasis(target, item, sentenceLevel)]));

      const doc = target.rootEl.ownerDocument;
      const range = TFD.setRangeForRun(scratchRange(doc), target.run, target.start, target.end);
      const span = doc.createElement('span');
      span.className = 'tfd-sentence';
      span.dataset.tfdState = 'pending';
      span.append(range.extractContents());
      range.insertNode(span);
      jobs[i] = { target, span, source, items, sentenceLevel, itemLevel };
    }
    return jobs;
  }

  // 우리 DOM 작업은 사본 변화 감시(mirror.js)에서 뺀다.
  const quietly = (fn) => (TFD.quietly ? TFD.quietly(fn) : fn());

  // ② 채우기: "번역 중" span의 원문을 보관하고 번역문으로 바꾼다.
  function fillTranslation(job, parts) {
    quietly(() => fillSpan(job, parts));
  }

  function fillSpan(job, parts) {
    const { span } = job;
    const doc = span.ownerDocument;
    const original = doc.createDocumentFragment();
    original.append(...span.childNodes);
    const content = doc.createDocumentFragment();
    content.append(...renderParts(doc, parts, job));
    span.append(wrapWith(content, job.sentenceLevel));

    const id = String(nextId++);
    span.dataset.tfdId = id;
    span.dataset.tfdState = 'translated';
    span.lang = 'ko';
    stored.set(id, { original, translated: null });
  }

  // 번역하지 못한 "번역 중" span을 걷어 내고 원문을 제자리에 되돌린다.
  // span 앞에 하나씩 옮긴 뒤 span을 지운다. (replaceWith를 쓰면 "다시 시도" 범위의 끝 경계 밖으로 원문이 밀려난다)
  function unwrap(span) {
    const parent = span.parentNode;
    if (!parent) return;
    quietly(() => {
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      span.remove();
      parent.normalize();
    });
  }

  /**
   * 다른 경로(코드 주석 번역 등)에서 만든 번역문 span을 문장으로 등록한다. 원문 전환·원본 보기가 문장과 똑같이 동작한다.
   * @param {HTMLSpanElement} span 번역문이 들어 있는 span.tfd-sentence
   * @param {DocumentFragment} original 원문 조각
   */
  function adoptTranslation(span, original) {
    const id = String(nextId++);
    span.dataset.tfdId = id;
    span.dataset.tfdState = 'translated';
    span.lang = 'ko';
    stored.set(id, { original, translated: null });
  }

  // 문장 span의 내용을 보관해 둔 반대 상태(원문/번역문) 조각과 맞바꾼다.
  function swap(span, nextState) {
    const entry = stored.get(span.dataset.tfdId);
    const currentState = span.dataset.tfdState;
    if (!entry || currentState === nextState) return false;
    quietly(() => swapContent(span, entry, currentState, nextState));
    return true;
  }

  function swapContent(span, entry, currentState, nextState) {
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
  }

  function spansInRange(selRange, state) {
    // 선택 영역이 Shadow DOM 안이면 그 Shadow root에서 찾는다. (document에서는 안이 보이지 않음)
    const scope = selRange.commonAncestorContainer.getRootNode();
    const root = scope && scope.querySelectorAll ? scope : selRange.startContainer.ownerDocument;
    return Array.from(root.querySelectorAll(`span.tfd-sentence[data-tfd-state="${state}"]`))
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

  const samePosition = (a, b) => a.node === b.node && a.el === b.el && a.offset === b.offset;
  const sameTarget = (a, b) =>
    samePosition(a.positions[0], b.positions[0]) &&
    samePosition(a.positions[a.positions.length - 1], b.positions[b.positions.length - 1]);

  // 문장 시작 위치로 문서 순서를 비교한다.
  function compareTargets(a, b) {
    const range = scratchRange(a.rootEl.ownerDocument);
    range.setStart(...TFD.startPoint(a.positions[0]));
    range.collapse(true);
    return -range.comparePoint(...TFD.startPoint(b.positions[0]));
  }

  /*
   * 번역할 문장을 정한다.
   * 페이지가 관리하는 원본 문단은 건드리지 않고, 사본을 만들어(mirror.js) 사본 안의 같은 문장을 번역한다.
   * 이미 사본 안이거나 문서 최상위 글자는 그 자리에서 번역하고,
   * 동영상·캔버스·iframe 등이 있어 복제할 수 없는 문단은 번역하지 않는다.
   * @returns {{targets: object[], skipped: number, after: Function[]}} after: 번역을 반영한 뒤 실행할 작업
   */
  function prepareTargets(selRange, deps) {
    const initial = collectSentences(selRange);
    // 사본을 만들면 원본이 숨김 처리되어 판정이 달라지므로, 문단과 처리 방식은 사본을 만들기 전에 모두 정해 둔다.
    const ownerOf = initial.map(ownerBlock);
    const modeOf = ownerOf.map((owner) => (owner ? TFD.mirrorMode(owner) : 'in-place'));
    const owners = [];
    ownerOf.forEach((owner, i) => {
      if (modeOf[i] === 'mirror' && !owners.includes(owner)) owners.push(owner);
    });
    // 문단 안에 다른 문단이 있으면(목록 안의 목록 등) 바깥 문단 하나만 사본으로 만든다.
    const outermost = owners.filter((o) => !owners.some((p) => p !== o && p.contains(o)));

    const targets = [];
    const after = [];
    let skipped = 0;
    const handled = new Map(); // 바깥 문단 → 사본을 만들었는지
    for (const [i, target] of initial.entries()) {
      if (modeOf[i] === 'skip') {
        skipped++;
        continue;
      }
      const top = modeOf[i] === 'mirror' && outermost.find((o) => o.contains(ownerOf[i]));
      if (!top) {
        targets.push(target);
        continue;
      }
      if (handled.has(top)) {
        if (!handled.get(top)) skipped++;
        continue;
      }
      const mirrored = TFD.mirrorBlock(top, deps);
      handled.set(top, !!mirrored);
      if (!mirrored) {
        skipped++;
        continue;
      }
      const { copy, carried } = mirrored;
      const selected = collectSentences(mapRangeToCopy(selRange, top, copy), copy);
      // 안쪽 문단 사본에서 번역해 두었던 문장도 바깥 사본에서 다시 번역한다. (같은 문장은 캐시라 바로 나옴)
      if (carried.length) {
        const extra = TFD.pickTargets(collectSentences(null, copy), carried.map((s) => s.text));
        for (const t of extra) if (!selected.some((s) => sameTarget(s, t))) selected.push(t);
        selected.sort(compareTargets);
        after.push(() => applySentenceStates(copy, carried));
      }
      targets.push(...selected);
    }
    return { targets, skipped, after };
  }

  /**
   * ② 읽는 순서대로 번역하며, 끝나는 문장부터 바로 화면에 반영한다.
   * 멈추면(시간 초과·취소) 남은 "번역 중" 문장은 원문으로 되돌린다.
   * @param {() => boolean} [isValid] false면 번역하지 않는다. (그사이 사본이 다시 만들어진 경우)
   * @returns {Promise<{translated: number, failed: number, rebuilt: number, done: number, interrupted: Error|null}>}
   *   translated: 실제로 화면에 반영한 문장 수, rebuilt: 사본이 다시 만들어져 그쪽에서 다시 번역하게 된 문장 수,
   *   done: 처리를 마친 문장 수(반영·실패·넘김 포함)
   */
  async function fillTranslations(jobs, deps, isValid = () => true) {
    let translated = 0;
    let failed = 0;
    let rebuilt = 0;
    let interrupted = null;
    let i = 0;
    for (; i < jobs.length; i++) {
      const job = jobs[i];
      // 사본이 다시 만들어져 화면에서 사라진 문장은 번역기도 부르지 않는다. (새 사본에서 다시 번역됨)
      if (!job.span.isConnected || !isValid()) {
        rebuilt++;
        continue;
      }
      let output;
      try {
        output = await translateCached(job.source, deps);
        job.target.linkLabels = await translateLinks(job.target, job.items, deps);
      } catch (err) {
        interrupted = err;
        break;
      }
      if (!job.span.isConnected) {
        rebuilt++;
        continue;
      }
      // 번역된 링크 뒤의 조사는 한국어 링크 글자의 받침에 맞춘다.
      const displayText = (item) => {
        const label = job.target.linkLabels.get(item);
        return label && label.text;
      };
      const restored = TFD.restoreSentence(output, job.items, displayText);
      if (restored.ok) {
        fillTranslation(job, restored.parts);
        remember(job.source, deps);
        translated++;
      } else {
        failed++;
        unwrap(job.span);
      }
    }
    const done = i;
    for (; i < jobs.length; i++) {
      if (jobs[i].span.dataset.tfdState === 'pending') unwrap(jobs[i].span);
    }
    return { translated, failed, rebuilt, done, interrupted };
  }

  /** 사본을 다시 만들 때 쓰는 번역: 감싸고 채운다. */
  async function translateTargets(targets, deps, isValid = () => true) {
    if (!isValid()) return { translated: 0, failed: 0, rebuilt: 0, done: 0, interrupted: null };
    const jobs = wrapPending(targets, deps.detector);
    await prefetch(jobs, deps);
    return fillTranslations(jobs, deps, isValid);
  }

  /**
   * @param {Range} selRange 사용자가 드래그한 영역
   * @param {{translate: (s: string) => Promise<string>, backgroundTranslate?: (s: string) => Promise<string>, detector: object, store?: object}} deps
   *   backgroundTranslate: 페이지가 원본을 바꿔 사본을 다시 번역할 때 쓰는 번역 함수 (사용자 취소와 무관)
   *   store: 번역 결과 기기 저장소 (translation-store.js). 없으면 메모리에만 둔다.
   * @returns {Promise<{translated: number, failed: number, rebuilt: number, skipped: number, remaining: number, interrupted: Error|null, scope: Range}>}
   *   rebuilt: 번역 도중 페이지가 문단을 바꿔, 새 사본에서 다시 번역하게 된 문장 수
   *   skipped: 복제할 수 없는 문단(동영상·캔버스·iframe 등)이라 번역하지 않은 문장 수
   *   interrupted: 번역이 중간에 멈춘 이유(시간 초과, 취소 등). 그 전에 끝난 문장은 화면에 반영된다.
   *   scope: 실제로 번역 대상이 된 범위. 원본 대신 사본을 번역했으면 사본 위의 범위다.
   */
  async function translateRange(selRange, deps) {
    // 원문으로 돌려 둔 문장은 보관해 둔 번역문으로 바로 되돌린다.
    let reshown = 0;
    for (const span of spansInRange(selRange, 'original')) if (swap(span, 'translated')) reshown++;

    const { targets, skipped, after } = prepareTargets(selRange, deps);
    const jobs = wrapPending(targets, deps.detector);
    const scope = scopeOf(jobs, selRange);
    await prefetch(jobs, deps);
    const { translated, failed, rebuilt, done, interrupted } = await fillTranslations(jobs, deps);
    for (const task of after) task();
    return {
      translated: translated + reshown,
      failed,
      rebuilt,
      skipped,
      remaining: jobs.length - done,
      interrupted,
      scope,
    };
  }

  // 번역 대상 문장들(사본 안일 수 있음)을 감싸는 Range. "다시 시도"에 쓴다.
  // 살아 있는 Range라 문장이 번역되거나 원문으로 되돌려져도 범위가 따라간다.
  function scopeOf(jobs, fallback) {
    if (!jobs.length) return fallback.cloneRange();
    const scope = jobs[0].span.ownerDocument.createRange();
    scope.setStartBefore(jobs[0].span);
    scope.setEndAfter(jobs[jobs.length - 1].span);
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

  /** 번역 상태의 문장 span을 원문으로 보여 준다. (클릭용) */
  function showOriginal(span) {
    return swap(span, 'original');
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
  TFD.plainTextOf = plainTextOf;
  TFD.showOriginalInRange = showOriginalInRange;
  TFD.touchesTranslation = touchesTranslation;
  TFD.showTranslation = showTranslation;
  TFD.showOriginal = showOriginal;
  TFD.adoptTranslation = adoptTranslation;
  TFD.translateCached = translateCached;
  TFD.rememberTranslation = remember;
  TFD.isInterruption = isInterruption;
})(typeof globalThis !== 'undefined' ? globalThis : this);
