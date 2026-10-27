/*
 * 문장 분할기
 *
 * 기본 분할은 브라우저/Node 내장 Intl.Segmenter(UAX #29)에 맡기고,
 * 개발 문서에서 자주 틀리는 경우만 규칙으로 보정한다.
 *
 * - 줄바꿈은 문장을 끊지 않는다. (하나의 문장은 줄바꿈으로 나뉘지 않는다)
 * - 약어(e.g., i.e., Dr. ...) 뒤에서는 끊지 않는다.
 * - Node.js, v1.2.3, array.map(), 3.14 같은 마침표는 Segmenter가 이미 끊지 않는다.
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  // 이 약어로 끝나는 조각은 다음 조각과 합친다. (대소문자 구분)
  // "etc."는 문장 끝에도 자주 오므로 넣지 않는다.
  const ABBREVIATIONS = [
    'e.g.', 'i.e.', 'vs.', 'cf.', 'approx.', 'a.k.a.', 'et al.', 'viz.',
    'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'Sr.', 'Jr.', 'St.',
    'Inc.', 'Ltd.', 'Co.', 'Corp.',
    'No.', 'Nos.', 'Fig.', 'Figs.', 'Eq.', 'Vol.', 'Ch.', 'Sec.', 'pp.', 'p.', 'v.', 'ver.',
    'Jan.', 'Feb.', 'Mar.', 'Apr.', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Sept.', 'Oct.', 'Nov.', 'Dec.',
    'U.S.', 'U.K.', 'E.U.',
  ];

  // 줄바꿈 계열 문자는 같은 길이의 공백으로 바꿔 오프셋을 유지한다.
  const LINE_BREAKS = /[\r\n\u2028\u2029\u0085\v\f]/g;

  let segmenter = null;
  function getSegmenter() {
    if (!segmenter) segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    return segmenter;
  }

  function endsWithAbbreviation(text) {
    const trimmed = text.replace(/\s+$/, '');
    return ABBREVIATIONS.some((abbr) => {
      if (!trimmed.endsWith(abbr)) return false;
      const before = trimmed.charAt(trimmed.length - abbr.length - 1);
      // "the.e.g." 같은 부분 일치를 막기 위해 앞 글자는 공백/여는 괄호/문자열 시작이어야 한다.
      return before === '' || /[\s(\[{"'“‘]/.test(before);
    });
  }

  /**
   * @param {string} text
   * @returns {{start: number, end: number, text: string}[]} 앞뒤 공백을 뺀 문장 범위
   */
  function splitSentences(text) {
    if (!text) return [];
    const normalized = text.replace(LINE_BREAKS, ' ');

    const pieces = [];
    for (const { segment, index } of getSegmenter().segment(normalized)) {
      const last = pieces[pieces.length - 1];
      if (last && endsWithAbbreviation(last.raw)) {
        last.raw += segment;
      } else {
        pieces.push({ start: index, raw: segment });
      }
    }

    const sentences = [];
    for (const { start, raw } of pieces) {
      const lead = raw.length - raw.replace(/^\s+/, '').length;
      const body = raw.trim();
      if (!body) continue;
      const s = start + lead;
      sentences.push({ start: s, end: s + body.length, text: body });
    }
    return sentences;
  }

  TFD.splitSentences = splitSentences;
  TFD.SENTENCE_ABBREVIATIONS = ABBREVIATIONS;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { splitSentences, ABBREVIATIONS };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
