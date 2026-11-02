/*
 * 코드 블록 안의 주석 찾기 (DOM과 무관한 순수 로직)
 *
 * - findComments(text, lang): 하이라이터 표시가 없을 때 주석 기호로 주석 범위를 찾는다.
 *   언어를 알면 그 언어의 기호만, 모르면 //, #, /* *\/, <!-- --> 를 조심스럽게 쓴다.
 *   셸·콘솔 블록은 #이 프롬프트일 수 있어서 기호로 찾지 않는다(하이라이터가 표시한 주석만 쓴다).
 * - commentLines(text, ranges): 주석 범위를 줄 단위로 나누고, 주석 기호를 뺀 본문 위치를 구한다.
 * - groupLines(lines): 이어지는 같은 종류의 주석 줄을 한 묶음(한 번에 번역할 문장)으로 모은다.
 * - splitTranslation(text, weights): 묶음의 번역문을 원래 줄 수에 맞춰 단어 경계에서 나눈다.
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

  const SLASH = words('js jsx ts tsx javascript typescript mjs cjs java kotlin kt c h cpp cxx cc hpp c++ cs csharp go golang rust rs swift scala dart groovy gradle json5 jsonc solidity sol zig objc objectivec proto protobuf');
  const CSS = words('css');
  const CSS_LIKE = words('scss sass less stylus');
  const HASH = words('python py python3 ruby rb yaml yml toml perl pl r dockerfile docker makefile make cmake conf properties elixir ex exs nix graphql gql tcl awk julia crystal coffee coffeescript hcl terraform tf starlark bazel');
  const SHELL = words('bash sh shell zsh fish console shell-session shellsession sh-session terminal powershell ps1 ps bat cmd batch');
  const DASH = words('sql mysql postgresql postgres psql plsql tsql lua haskell hs ada vhdl elm');
  const MARKUP = words('html xml svg xhtml markdown md mdx');
  const MARKUP_SCRIPT = words('vue svelte astro php');
  const SEMI = words('asm nasm armasm x86asm s ini lisp clojure clj scheme elisp');

  const C_BLOCK = ['/*', '*/'];
  const HTML_BLOCK = ['<!--', '-->'];

  /**
   * @param {string} lang 하이라이터가 붙인 언어 이름 (소문자, 없으면 '')
   * @returns {{line: string[], block: string[][], guardedHash: boolean} | null} null이면 기호로 찾지 않음
   */
  function syntaxFor(lang) {
    const l = (lang || '').toLowerCase();
    if (SHELL.has(l)) return null;
    if (SLASH.has(l)) return { line: ['//'], block: [C_BLOCK], guardedHash: false };
    if (CSS.has(l)) return { line: [], block: [C_BLOCK], guardedHash: false };
    if (CSS_LIKE.has(l)) return { line: ['//'], block: [C_BLOCK], guardedHash: false };
    if (HASH.has(l)) return { line: ['#'], block: [], guardedHash: false };
    if (DASH.has(l)) return { line: ['--'], block: [C_BLOCK], guardedHash: false };
    if (MARKUP.has(l)) return { line: [], block: [HTML_BLOCK], guardedHash: false };
    if (MARKUP_SCRIPT.has(l)) return { line: ['//'], block: [HTML_BLOCK, C_BLOCK], guardedHash: false };
    if (SEMI.has(l)) return { line: [';', '#'], block: [C_BLOCK], guardedHash: true };
    // 언어를 모름: 흔한 기호만, #은 조건을 붙여서
    return { line: ['//', '#'], block: [C_BLOCK, HTML_BLOCK], guardedHash: true };
  }

  const PREPROCESSOR = /^\s*#\s*(?:include|define|undef|if|ifdef|ifndef|elif|else|endif|pragma|import|error|warning|line)\b/;

  function lineStart(text, i) {
    return text.lastIndexOf('\n', i - 1) + 1;
  }

  function lineEnd(text, i) {
    const n = text.indexOf('\n', i);
    return n === -1 ? text.length : n;
  }

  const atWordBoundary = (text, i) => i === 0 || /\s/.test(text[i - 1]);

  function lineMarkerOk(text, i, marker, syntax) {
    if (marker === '//') return !/:$/.test(text.slice(Math.max(0, i - 1), i)); // http://
    if (marker === '#') {
      if (!atWordBoundary(text, i)) return false; // a#b, url#frag
      if (!syntax.guardedHash) return true;
      const rest = text.slice(i + 1, i + 2);
      if (text.startsWith('#!', i)) return false;
      if (PREPROCESSOR.test(text.slice(lineStart(text, i), lineEnd(text, i)))) return false;
      return rest === '' || rest === ' ' || rest === '\n';
    }
    if (marker === '--' || marker === ';') return atWordBoundary(text, i) && /[\s]|$/.test(text[i + marker.length] || ' ');
    return true;
  }

  /**
   * 주석 기호로 주석 범위를 찾는다. 따옴표 안의 기호는 무시한다.
   * @returns {{start: number, end: number}[]} 기호를 포함한 주석 범위 (여러 줄일 수 있음)
   */
  function findComments(text, lang) {
    const syntax = syntaxFor(lang);
    if (!syntax) return [];
    const ranges = [];
    let quote = null;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote || (ch === '\n' && quote !== '`')) quote = null;
        continue;
      }
      const block = syntax.block.find(([open]) => text.startsWith(open, i));
      if (block) {
        const close = text.indexOf(block[1], i + block[0].length);
        const end = close === -1 ? text.length : close + block[1].length;
        ranges.push({ start: i, end });
        i = end - 1;
        continue;
      }
      const marker = syntax.line.find((m) => text.startsWith(m, i));
      if (marker && lineMarkerOk(text, i, marker, syntax)) {
        const end = lineEnd(text, i);
        ranges.push({ start: i, end });
        i = end - 1;
        continue;
      }
      if (ch === '"' || ch === '`' || (ch === "'" && !/[A-Za-z0-9]/.test(text[i - 1] || ''))) quote = ch;
    }
    return ranges;
  }

  const LEAD = /^(\s*)(\/\/[/!]?|#+|\/\*+!?|\*+(?!\/)|<!--|--|;+)?\s*/;
  const TRAIL = /\s*(\*+\/|-->)\s*$/;

  function lineOfOffset(text, offset) {
    let n = 0;
    for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) n++;
    return n;
  }

  /**
   * 주석 범위를 줄 단위로 나누고 기호를 뺀 본문 위치를 구한다.
   * @returns {{line: number, start: number, end: number, bodyStart: number, bodyEnd: number, whole: boolean, kind: string}[]}
   *   whole: 그 줄에 주석만 있음(앞에 코드가 없음). kind: 'line' | 'block' (묶음을 나누는 기준)
   */
  function commentLines(text, ranges) {
    const out = [];
    for (const range of ranges) {
      const raw = text.slice(range.start, range.end);
      // 블록 주석의 이어지는 줄(" * …")을 하이라이터가 따로 표시한 경우도 블록으로 본다.
      const kind = /^\s*(\/\*|<!--|\*(?!\/))/.test(raw) ? 'block' : 'line';
      let pos = range.start;
      for (const part of raw.split('\n')) {
        const start = pos;
        const end = pos + part.length;
        pos = end + 1;
        const lead = part.match(LEAD)[0].length;
        const trail = (part.slice(lead).match(TRAIL) || [''])[0].length;
        const bodyStart = start + lead;
        const bodyEnd = Math.max(bodyStart, end - trail);
        const before = text.slice(lineStart(text, start), start);
        out.push({ line: lineOfOffset(text, start), start, end, bodyStart, bodyEnd, whole: /^\s*$/.test(before), kind });
      }
    }
    return out;
  }

  /** 번역할 만한 본문인가: 영어 단어가 있고 한글보다 영문자가 많음 */
  function isEnglishComment(body) {
    if (!/[A-Za-z]{2,}/.test(body)) return false;
    const latin = (body.match(/[A-Za-z]/g) || []).length;
    const hangul = (body.match(/[가-힣]/g) || []).length;
    return latin >= hangul;
  }

  /**
   * 이어지는 주석 줄을 묶는다: 같은 종류, 줄 번호가 연속, 둘 다 줄 전체가 주석.
   * 블록 주석은 같은 주석 범위 안의 줄끼리 묶는다. 코드 뒤에 붙은 주석은 혼자 묶음이 된다.
   */
  function groupLines(lines) {
    const groups = [];
    let current = null;
    for (const seg of lines) {
      const prev = current && current[current.length - 1];
      const joins = prev && prev.kind === seg.kind && seg.line === prev.line + 1 &&
        ((seg.kind === 'block' && prev.end + 1 === seg.start) || (seg.kind === 'line' && prev.whole && seg.whole));
      if (joins) current.push(seg);
      else groups.push((current = [seg]));
    }
    return groups;
  }

  /**
   * 번역문을 원래 줄 길이 비율로 나눈다. 단어 경계(공백)에서 자르고, 줄 수는 weights.length로 유지한다.
   * @param {string} text
   * @param {number[]} weights 줄마다 원래 본문 길이
   * @returns {string[]}
   */
  function splitTranslation(text, weights) {
    const n = weights.length;
    if (n <= 1) return [text.trim()];
    const tokens = text.trim().split(/(\s+)/).filter((t) => t !== '');
    const total = weights.reduce((a, b) => a + Math.max(1, b), 0);
    const length = text.trim().length;
    const parts = [];
    let buf = '';
    let used = 0;
    let target = (Math.max(1, weights[0]) / total) * length;
    let line = 0;
    for (const token of tokens) {
      const isSpace = /^\s+$/.test(token);
      if (isSpace && line < n - 1 && used + buf.length >= target && buf.trim()) {
        parts.push(buf.trim());
        used += buf.length;
        buf = '';
        line++;
        target += (Math.max(1, weights[line]) / total) * length;
        continue;
      }
      buf += token;
    }
    parts.push(buf.trim());
    while (parts.length < n) parts.push('');
    return parts;
  }

  TFD.commentSyntaxFor = syntaxFor;
  TFD.findComments = findComments;
  TFD.commentLines = commentLines;
  TFD.groupCommentLines = groupLines;
  TFD.splitTranslation = splitTranslation;
  TFD.isEnglishComment = isEnglishComment;
  TFD.lineOfOffset = lineOfOffset;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { syntaxFor, findComments, commentLines, groupLines, splitTranslation, isEnglishComment, lineOfOffset };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
