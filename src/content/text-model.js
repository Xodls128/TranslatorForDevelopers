/*
 * DOM → 텍스트 모델
 *
 * 블록 요소 하나 아래의 인라인 내용을 "run"이라는 평평한 문자열로 펼친다.
 * run의 글자 하나하나는 원래 DOM 위치(텍스트 노드 + 오프셋, 또는 요소 하나)를 기억하므로
 * 문장 분할 결과(문자열 오프셋)를 그대로 DOM Range로 되돌릴 수 있다.
 *
 * - 공백은 화면처럼 하나로 접고, <br>과 줄바꿈은 문장을 끊지 않는 공백으로 본다.
 * - <code>, <kbd>, <a> 같은 요소는 통째로 한 글자(U+E000~)로 표시하고 번역하지 않는다.
 * - 블록 요소 경계, <pre>, 이미 번역된 문장(.tfd-sentence)은 run을 끊는다.
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  const UI_HOST_ID = 'tfd-ui-host';

  const SKIP_TAGS = new Set([
    'script', 'style', 'noscript', 'template', 'svg', 'math', 'canvas', 'iframe', 'object',
    'video', 'audio', 'textarea', 'input', 'select', 'option', 'button',
  ]);
  // 통째로 보존하는 인라인 요소. <a>는 링크 기능을 살리기 위해 MVP에서는 원문 그대로 둔다.
  const ATOM_TAGS = new Set(['code', 'kbd', 'samp', 'var', 'tt', 'a', 'img', 'picture']);
  const CODE_TAGS = new Set(['code', 'kbd', 'samp', 'var', 'tt']);
  // 계산된 스타일을 쓸 수 없을 때(테스트 등)만 쓰는 블록 태그 목록
  const BLOCK_TAGS = new Set([
    'html', 'body', 'p', 'div', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'pre', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'figure',
    'figcaption', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'details',
    'summary', 'form', 'fieldset', 'legend', 'hr', 'address',
  ]);

  // 제목은 짧고 맥락이 없어 번역 품질이 낮고, 대부분 용어 위주라 영어로 둔다.
  const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

  function isHeading(el) {
    return el.matches(HEADING_SELECTOR);
  }

  /** node가 제목 요소 안에 있는지 */
  function inHeading(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !!el && !!el.closest(HEADING_SELECTOR);
  }

  function isNoTranslate(el) {
    return el.getAttribute('translate') === 'no' || el.classList.contains('notranslate');
  }

  /**
   * @returns {'skip'|'opaque'|'block'|'br'|'atom'|'inline'}
   *   opaque: run을 끊고 안으로 들어가지 않음, block: run을 끊고 안으로 들어감
   */
  function classify(el) {
    const name = el.localName;
    // 사본을 만들어 숨긴 원본 문단(mirror.js)은 화면에 없는 것으로 본다.
    if (SKIP_TAGS.has(name) || el.id === UI_HOST_ID || el.hasAttribute('data-tfd-hidden')) return 'skip';
    if (name === 'pre' || el.classList.contains('tfd-sentence') || isHeading(el)) return 'opaque';

    const view = el.ownerDocument && el.ownerDocument.defaultView;
    const display = view && view.getComputedStyle ? view.getComputedStyle(el).display : '';
    if (display === 'none') return 'skip';

    const isInline = display
      ? display === 'inline' || display === 'contents' || display.startsWith('inline')
      : !BLOCK_TAGS.has(name);

    if (!isInline) return isNoTranslate(el) || CODE_TAGS.has(name) ? 'opaque' : 'block';
    if (name === 'br') return 'br';
    if (ATOM_TAGS.has(name) || isNoTranslate(el)) return 'atom';
    // inline-block 등은 배지/버튼인 경우가 많아 통째로 보존한다.
    if (display && display !== 'inline' && display !== 'contents') return 'atom';
    return 'inline';
  }

  /**
   * @param {Element} rootEl
   * @returns {{text: string, positions: object[], atoms: Element[]}[]}
   *   positions[i]: text[i]의 DOM 위치. {node, offset} (텍스트) 또는 {el} (요소 하나)
   */
  function buildRuns(rootEl) {
    const runs = [];
    let cur = { text: '', positions: [], atoms: [] };

    function flush() {
      if (cur.text.endsWith(' ')) {
        cur.text = cur.text.slice(0, -1);
        cur.positions.pop();
      }
      if (cur.text) runs.push(cur);
      cur = { text: '', positions: [], atoms: [] };
    }

    function emitSpace(pos) {
      if (cur.text === '' || cur.text.endsWith(' ')) return;
      cur.text += ' ';
      cur.positions.push(pos);
    }

    function walk(node) {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const data = child.data;
          for (let i = 0; i < data.length; i++) {
            if (/\s/.test(data[i])) {
              emitSpace({ node: child, offset: i });
            } else {
              cur.text += data[i];
              cur.positions.push({ node: child, offset: i });
            }
          }
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          switch (classify(child)) {
            case 'skip':
              break;
            case 'br':
              emitSpace({ el: child });
              break;
            case 'atom':
              cur.text += TFD.atomChar(cur.atoms.length);
              cur.positions.push({ el: child });
              cur.atoms.push(child);
              break;
            case 'inline':
              walk(child);
              break;
            case 'block':
              flush();
              walk(child);
              flush();
              break;
            case 'opaque':
              flush();
              break;
          }
        }
      }
    }

    walk(rootEl);
    flush();
    return runs;
  }

  function childIndex(node) {
    return Array.prototype.indexOf.call(node.parentNode.childNodes, node);
  }

  /** 글자 위치의 시작 경계 [노드, 오프셋] (글자가 요소면 그 요소의 앞) */
  function startPoint(pos) {
    return pos.el ? [pos.el.parentNode, childIndex(pos.el)] : [pos.node, pos.offset];
  }

  /** 글자 위치의 끝 경계 [노드, 오프셋] (글자가 요소면 그 요소의 뒤) */
  function endPoint(pos) {
    return pos.el ? [pos.el.parentNode, childIndex(pos.el) + 1] : [pos.node, pos.offset + 1];
  }

  /** 이미 있는 Range를 run의 [start, end) 구간으로 맞춘다. (Range를 새로 만들지 않고 재사용할 때) */
  function setRangeForRun(range, run, start, end) {
    range.setStart(...startPoint(run.positions[start]));
    range.setEnd(...endPoint(run.positions[end - 1]));
    return range;
  }

  /** run의 [start, end) 구간에 해당하는 DOM Range */
  function rangeForRun(run, start, end) {
    const first = run.positions[start];
    return setRangeForRun((first.node || first.el).ownerDocument.createRange(), run, start, end);
  }

  TFD.UI_HOST_ID = UI_HOST_ID;
  TFD.classifyElement = classify;
  TFD.inHeading = inHeading;
  TFD.buildRuns = buildRuns;
  TFD.rangeForRun = rangeForRun;
  TFD.setRangeForRun = setRangeForRun;
  TFD.startPoint = startPoint;
  TFD.endPoint = endPoint;
})(typeof globalThis !== 'undefined' ? globalThis : this);
