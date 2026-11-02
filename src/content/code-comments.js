/*
 * 코드 블록 안 주석 번역
 *
 * 드래그가 한 코드 블록(<pre>) 안에서 시작하고 끝날 때만 동작한다. 드래그가 걸친 줄의 주석만 번역하고 코드는 건드리지 않는다.
 * - 주석 찾기: 하이라이터가 붙인 주석 클래스를 먼저 보고, 하이라이터 표시가 없으면 주석 기호로 찾는다(src/core/comment-finder.js).
 * - 이어지는 주석 줄은 한 문장으로 번역한 뒤, 원래 줄 수에 맞춰 나눠 넣는다. (줄 번호와 정렬 유지)
 * - 문단처럼 코드 블록의 사본을 만들어 원본 앞에 두고, 사본의 주석 글자만 바꾼다. (사이트의 복사 버튼은 원본으로 전달됨)
 * - 번역한 주석은 문장 span(.tfd-sentence)이 되어 원문 전환·원본 보기·기기 저장이 문장과 똑같이 동작한다.
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  // 하이라이터가 주석에 붙이는 클래스 (Prism, highlight.js, Pygments, rustdoc, Sandpack/CodeMirror, GitHub)
  const COMMENT_SELECTOR = [
    '.comment', '.doccomment', '.token.comment', '[class*="hljs-comment"]', '.sp-syntax-comment', '.cm-comment', '.tok-comment',
    '.pl-c', 'span.c', 'span.c1', 'span.cm', 'span.ch', 'span.cs', 'span.cpf', 'span.cp1',
  ].join(', ');
  // 하이라이터가 있다는 표시. 있는데 주석 클래스가 없으면 그 블록에는 주석이 없다고 본다(기호로 추측하지 않음).
  const HIGHLIGHTER_CLASS = /(?:^|\s)(?:token|hljs-[\w-]+|sp-syntax-[\w-]+|cm-[\w-]+|tok-[\w-]+|pl-[\w-]+|kw|kw-2|ident|macro|string|number|bool-val|lifetime|prelude-ty|[a-z]{1,2}[0-9]?)(?:\s|$)/;
  const LANGUAGE = /(?:^|\s)(?:language|lang|highlight-source|highlight)-([\w+#-]+)/;

  /** 선택 영역의 시작과 끝이 같은 코드 블록 안이면 그 <pre>를 돌려준다. */
  function codeBlockOf(range) {
    const preOf = (node) => {
      const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      return el && el.closest('pre');
    };
    const start = preOf(range.startContainer);
    if (!start || start !== preOf(range.endContainer)) return null;
    if (start.closest('[data-tfd-hidden], #' + TFD.UI_HOST_ID)) return null;
    return start;
  }

  function languageOf(pre) {
    for (let el = pre, i = 0; el && i < 4; el = el.parentElement, i++) {
      if (el.dataset && el.dataset.language) return el.dataset.language.toLowerCase();
      const own = (el.className && el.className.baseVal === undefined ? el.className : '') + ' ' + ((el === pre && pre.querySelector('code')) ? pre.querySelector('code').className : '');
      const m = own.match(LANGUAGE);
      if (m) return m[1].toLowerCase();
    }
    return '';
  }

  const BLOCK_DISPLAY = /^(block|flex|grid|list-item|table|table-row)$/;

  /**
   * 코드 블록의 글자와 글자별 DOM 위치를 만든다. 줄이 <div>로 나뉜 하이라이터(CodeMirror 등)는 \n이 없으므로
   * 블록 요소 경계에 가상의 줄바꿈을 넣는다. (가상 글자는 DOM 위치가 없음)
   */
  function readCode(pre) {
    const doc = pre.ownerDocument;
    const view = doc.defaultView;
    let text = '';
    const nodes = []; // { node, start } 텍스트 노드와 그 시작 위치
    const walk = (el) => {
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          nodes.push({ node: child, start: text.length });
          text += child.data;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const block = BLOCK_DISPLAY.test(view.getComputedStyle(child).display);
          if (block && text && !text.endsWith('\n')) text += '\n';
          walk(child);
          if (block && text && !text.endsWith('\n')) text += '\n';
        }
      }
    };
    walk(pre);

    // 글자 위치 → DOM 위치 (텍스트 노드 + 오프셋)
    function locate(offset, preferEnd) {
      let found = null;
      for (const entry of nodes) {
        const end = entry.start + entry.node.data.length;
        if (offset < entry.start) break;
        if (offset < end || (offset === end && preferEnd)) found = { node: entry.node, offset: offset - entry.start };
        if (offset < end) break;
      }
      return found;
    }

    // DOM 경계 → 글자 위치
    function offsetOf(container, offset) {
      if (container.nodeType === Node.TEXT_NODE) {
        const entry = nodes.find((e) => e.node === container);
        if (entry) return entry.start + offset;
      }
      const point = doc.createRange();
      point.setStart(container, offset);
      for (const entry of nodes) {
        if (point.comparePoint(entry.node, 0) >= 0) return entry.start;
        if (point.comparePoint(entry.node, entry.node.data.length) >= 0) {
          // 경계가 이 텍스트 노드 안쪽에 있음 (container가 텍스트가 아닌 경우는 드묾)
          return entry.start;
        }
      }
      return text.length;
    }

    return { text, nodes, locate, offsetOf };
  }

  /**
   * 코드 블록의 주석 줄들. 하이라이터 클래스 우선, 하이라이터가 없을 때만 주석 기호로 찾는다.
   * @returns {{code: object, lines: object[]}}
   */
  function commentsOf(pre) {
    const code = readCode(pre);
    let ranges = [];
    const marked = [...pre.querySelectorAll(COMMENT_SELECTOR)].filter((el) => !el.parentElement.closest(COMMENT_SELECTOR) || !pre.contains(el.parentElement.closest(COMMENT_SELECTOR)));
    if (marked.length) {
      for (const el of marked) {
        const texts = [];
        const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let t = walker.nextNode(); t; t = walker.nextNode()) texts.push(t);
        if (!texts.length) continue;
        const first = code.nodes.find((e) => e.node === texts[0]);
        const last = code.nodes.find((e) => e.node === texts[texts.length - 1]);
        if (first && last) ranges.push({ start: first.start, end: last.start + last.node.data.length });
      }
    } else if (![...pre.querySelectorAll('[class]')].some((el) => HIGHLIGHTER_CLASS.test(el.getAttribute('class') || '') && !/^line\b/.test(el.getAttribute('class')))) {
      ranges = TFD.findComments(code.text, languageOf(pre));
    }
    return { code, lines: TFD.commentLines(code.text, ranges) };
  }

  // 선택 영역이 걸친 줄 번호 [first, last]
  function selectedLines(code, range) {
    const start = code.offsetOf(range.startContainer, range.startOffset);
    let end = code.offsetOf(range.endContainer, range.endOffset);
    if (end > start && code.text[end - 1] === '\n') end--; // 다음 줄 맨 앞에서 끝난 드래그는 그 줄을 빼고
    return [TFD.lineOfOffset(code.text, start), TFD.lineOfOffset(code.text, end)];
  }

  // 드래그가 걸친 줄에서 아직 번역하지 않은 영어 주석 묶음
  function pickGroups(pre, range) {
    const { code, lines } = commentsOf(pre);
    const [first, last] = selectedLines(code, range);
    const inSentence = (seg) => {
      const pos = code.locate(seg.bodyStart);
      return pos && pos.node.parentElement && pos.node.parentElement.closest('.tfd-sentence');
    };
    const body = (seg) => code.text.slice(seg.bodyStart, seg.bodyEnd);
    const chosen = lines.filter((seg) => seg.line >= first && seg.line <= last && !inSentence(seg));
    const groups = TFD.groupCommentLines(chosen)
      .map((group) => group.filter((seg) => body(seg).trim()))
      .filter((group) => group.length && TFD.isEnglishComment(group.map(body).join(' ')));
    return { code, groups, body };
  }

  /** 드래그가 걸친 줄에 번역할 영어 주석이 있는가 (번역 버튼을 띄울지 판단) */
  function hasCommentsToTranslate(pre, range) {
    return pickGroups(pre, range).groups.length > 0;
  }

  /**
   * 코드 블록 안 주석을 번역한다.
   * @param {Range} selRange 한 코드 블록 안의 선택 영역
   * @param {{translate: Function, detector: object, store?: object, backgroundTranslate?: Function}} deps
   * @returns {Promise<{translated: number, failed: number, rebuilt: number, skipped: number, remaining: number, interrupted: Error|null, scope: Range, unit: 'comment'}>}
   */
  async function translateCodeComments(selRange, deps) {
    const result = { translated: 0, failed: 0, rebuilt: 0, skipped: 0, remaining: 0, interrupted: null, scope: selRange, unit: 'comment' };
    const source = codeBlockOf(selRange);
    if (!source) return result;

    // 줄 번호는 원본에서 구한다. 사본은 원본을 그대로 복제해서 줄 구조가 같다.
    const lines = selectedLines(readCode(source), selRange);
    let pre = source;
    if (!source.closest('.tfd-copy')) {
      if (TFD.mirrorMode(source) === 'skip') return { ...result, skipped: 1 };
      const mirrored = TFD.mirrorBlock(source, deps);
      if (!mirrored) return { ...result, skipped: 1 };
      pre = mirrored.copy;
    }
    const scope = pre.ownerDocument.createRange();
    scope.selectNodeContents(pre);
    result.scope = scope;

    // 걸친 줄 범위를 사본 기준 선택 영역으로 다시 만든다.
    const lineRange = rangeForLines(pre, lines);
    const { code, groups, body } = pickGroups(pre, lineRange);

    // 번역 (DOM은 아직 건드리지 않는다)
    const jobs = [];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const text = group.map(body).map((s) => s.trim()).join(' ');
      const { source: input, items } = TFD.protectSentence(text, deps.detector);
      let output;
      try {
        output = await TFD.translateCached(input, deps);
      } catch (err) {
        if (TFD.isInterruption(err)) {
          result.interrupted = err;
          result.remaining = groups.length - i;
          break;
        }
        result.failed++;
        continue;
      }
      const restored = TFD.restoreSentence(output, items);
      if (!restored.ok) {
        result.failed++;
        continue;
      }
      const translated = restored.parts.map((p) => (p.type === 'text' ? p.text : p.item.text)).join('').trim();
      jobs.push({ group, input, parts: TFD.splitTranslation(translated, group.map((seg) => body(seg).trim().length)) });
    }

    // 화면 반영: 뒤쪽 주석부터 바꿔서 앞쪽 글자 위치가 틀어지지 않게 한다.
    const edits = [];
    for (const job of jobs) job.group.forEach((seg, k) => edits.push({ seg, text: job.parts[k] }));
    edits.sort((a, b) => b.seg.bodyStart - a.seg.bodyStart);
    const doc = pre.ownerDocument;
    (TFD.quietly || ((fn) => fn()))(() => {
      for (const { seg, text } of edits) {
        const start = code.locate(seg.bodyStart, false);
        const end = code.locate(seg.bodyEnd, true);
        if (!start || !end) continue;
        const range = doc.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        const original = range.extractContents();
        const span = doc.createElement('span');
        span.className = 'tfd-sentence';
        span.textContent = text;
        range.insertNode(span);
        TFD.adoptTranslation(span, original);
      }
    });
    for (const job of jobs) TFD.rememberTranslation(job.input, deps);
    result.translated = jobs.length;
    return result;
  }

  // 사본에서 [first, last] 줄을 덮는 선택 영역
  function rangeForLines(pre, [first, last]) {
    const code = readCode(pre);
    const lineStarts = [0];
    for (let i = code.text.indexOf('\n'); i !== -1; i = code.text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
    const startOffset = lineStarts[first] || 0;
    const endOffset = last + 1 < lineStarts.length ? lineStarts[last + 1] - 1 : code.text.length;
    const range = pre.ownerDocument.createRange();
    const s = code.locate(startOffset, false) || code.locate(startOffset, true);
    const e = code.locate(endOffset, true) || code.locate(endOffset, false);
    if (s) range.setStart(s.node, s.offset);
    else range.setStart(pre, 0);
    if (e) range.setEnd(e.node, e.offset);
    else range.setEnd(pre, pre.childNodes.length);
    return range;
  }

  TFD.codeBlockOf = codeBlockOf;
  TFD.hasCommentsToTranslate = hasCommentsToTranslate;
  TFD.translateCodeComments = translateCodeComments;
})(typeof globalThis !== 'undefined' ? globalThis : this);
