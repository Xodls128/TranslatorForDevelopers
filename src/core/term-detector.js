/*
 * 번역에서 보호할 구간 감지
 *
 * - term : 용어 사전(src/data/terms.js)에 있는 개발 용어. 클릭하면 검색 페이지로 이동한다.
 * - code : HTML 태그 없이 문장에 섞여 있는 코드 조각 (camelCase, snake_case, foo(), a.b, 경로, URL, --flag ...)
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  const NOT_WORD_BEFORE = '(?<![A-Za-z0-9_$])';
  const NOT_WORD_AFTER = '(?![A-Za-z0-9_$])';

  const CODE_PATTERNS = [
    // URL
    /\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/g,
    // 경로: /usr/bin, ./src/index.js, ~/.bashrc
    /(?<![\w./~-])(?:~|\.{1,2})?\/[\w.@-]+(?:\/[\w.@-]+)*\/?/g,
    // CLI 옵션: --save-dev, -v
    /(?<![\w-])--[A-Za-z][\w-]*/g,
    /(?<![\w-])-[A-Za-z](?![\w-])/g,
    // 함수 호출: foo(), obj.method(arg) — "item(s)"는 제외
    /(?<![\w$.])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\((?!s\))[^()\n]{0,40}\)/g,
    // 점으로 이어진 식별자: Node.js, array.map, config.yaml
    /(?<![\w$])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+(?![\w$])/g,
    // camelCase
    /(?<![\w$])[a-z]+(?:[A-Z][a-z0-9]*)+(?![\w$])/g,
    // 대문자가 두 번 이상 나오는 PascalCase: ArrayList, JavaScript
    /(?<![\w$])[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+(?![\w$])/g,
    // snake_case, SCREAMING_CASE, __dunder__
    /(?<![\w$])_*[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+_*(?![\w$])/g,
    /(?<![\w$])__[A-Za-z0-9]+__(?![\w$])/g,
    // 약어: API, HTTP, APIs
    /(?<![\w$])[A-Z][A-Z0-9]+s?(?![\w$])/g,
    // @decorator, #include
    /(?<![\w@#])[@#][A-Za-z_][\w-]*/g,
  ];

  // 대문자 약어처럼 보이지만 문서의 안내 문구라 번역해도 되는 단어
  const ACRONYM_STOPLIST = new Set(['NOTE', 'NOTES', 'WARNING', 'TIP', 'TIPS', 'IMPORTANT', 'CAUTION', 'DANGER', 'INFO', 'OK']);

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // "pull request" 처럼 여러 단어인 용어는 사이 공백을 유연하게 매칭한다.
  function phrase(term) {
    return term.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function isTitleCase(text) {
    const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
    const significant = words.filter((w) => w.length >= 4);
    if (significant.length === 0) return false;
    const capitalized = significant.filter((w) => /^[A-Z]/.test(w)).length;
    return capitalized / significant.length >= 0.8;
  }

  function compileEntry(term, mode, cuePattern) {
    const body = phrase(term);
    const plural = '(?:s|es)?';
    switch (mode) {
      case 'exact':
        return { term, mode, regexes: [new RegExp(NOT_WORD_BEFORE + body + NOT_WORD_AFTER, 'g')] };
      case 'word':
        return { term, mode, regexes: [new RegExp(NOT_WORD_BEFORE + body + plural + NOT_WORD_AFTER, 'gi')] };
      case 'context': {
        const lower = phrase(term.toLowerCase());
        const upper = phrase(capitalize(term.toLowerCase()));
        return {
          term,
          mode,
          // [0] 대문자형 (문장 중간 또는 제목형 문장에서만 인정), [1] 소문자 + 단서 단어
          regexes: [
            new RegExp(NOT_WORD_BEFORE + upper + plural + NOT_WORD_AFTER, 'g'),
            new RegExp(NOT_WORD_BEFORE + lower + plural + '(?=\\s+' + cuePattern + NOT_WORD_AFTER + ')', 'g'),
          ],
        };
      }
      default:
        throw new Error('Unknown term mode: ' + mode);
    }
  }

  /**
   * @param {object} [options]
   * @param {Array<[string, string]>} [options.terms] 기본 사전 (기본값: TFD.DEFAULT_TERMS)
   * @param {string[]} [options.cues] context 용어 단서 단어 (기본값: TFD.CONTEXT_CUES)
   * @param {string[]} [options.extraTerms] 사용자가 추가한 보존 용어
   * @param {string[]} [options.excludedTerms] 사용자가 보존에서 제외한 용어
   */
  function createTermDetector(options = {}) {
    const terms = options.terms || TFD.DEFAULT_TERMS || [];
    const cues = options.cues || TFD.CONTEXT_CUES || [];
    const excluded = new Set((options.excludedTerms || []).map((t) => t.trim().toLowerCase()).filter(Boolean));
    const cuePattern = '(?:' + cues.map(escapeRegExp).join('|') + ')';

    const entries = [];
    for (const [term, mode] of terms) {
      if (!excluded.has(term.toLowerCase())) entries.push(compileEntry(term, mode, cuePattern));
    }
    for (const raw of options.extraTerms || []) {
      const term = raw.trim();
      if (!term || excluded.has(term.toLowerCase())) continue;
      // 대문자가 섞인 용어는 고유명사로 보고 정확히 일치할 때만 보존한다.
      entries.push(compileEntry(term, /[A-Z]/.test(term) ? 'exact' : 'word', cuePattern));
    }

    function isExcluded(text) {
      if (excluded.size === 0) return false;
      const lower = text.toLowerCase();
      return excluded.has(lower) || excluded.has(lower.replace(/e?s$/, ''));
    }

    /**
     * @param {string} text 문장 하나
     * @returns {{start: number, end: number, text: string, kind: 'term'|'code', term: string}[]}
     *   겹치지 않는 보호 구간, 시작 위치 순
     */
    function detect(text) {
      const candidates = [];
      const titleCase = isTitleCase(text);
      const firstWord = text.search(/[A-Za-z]/);

      for (const entry of entries) {
        entry.regexes.forEach((regex, i) => {
          regex.lastIndex = 0;
          for (const m of text.matchAll(regex)) {
            const isUpperForm = entry.mode === 'context' && i === 0;
            if (isUpperForm && m.index === firstWord && !titleCase) continue;
            candidates.push({ start: m.index, end: m.index + m[0].length, text: m[0], kind: 'term', term: entry.term });
          }
        });
      }

      for (const regex of CODE_PATTERNS) {
        regex.lastIndex = 0;
        for (const m of text.matchAll(regex)) {
          const s = m[0];
          if (ACRONYM_STOPLIST.has(s)) continue;
          // e.g, i.e, U.S 처럼 한 글자씩 점으로 이어진 약어는 코드가 아니다.
          if (/^[A-Za-z](?:\.[A-Za-z])+$/.test(s)) continue;
          candidates.push({ start: m.index, end: m.index + s.length, text: s, kind: 'code', term: s });
        }
      }

      // 먼저 시작 → 더 긴 것 → 용어(term) 우선 순으로 겹치지 않게 고른다.
      candidates.sort((a, b) => a.start - b.start || b.end - a.end || (a.kind === 'term' ? -1 : 1));
      const spans = [];
      let cursor = 0;
      for (const c of candidates) {
        if (c.start < cursor) continue;
        if (isExcluded(c.text)) continue;
        spans.push(c);
        cursor = c.end;
      }
      return spans;
    }

    return { detect };
  }

  TFD.createTermDetector = createTermDetector;
  TFD.isTitleCase = isTitleCase;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createTermDetector, isTitleCase };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
