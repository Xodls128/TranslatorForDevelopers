/*
 * 개발 용어 검색어 / 검색 URL 생성
 *
 * 지금은 "프로그래밍언어 Union"처럼 고정 접두어를 붙인다.
 * 추후 문서에서 언어/라이브러리 힌트를 뽑아 context.topic으로 넘기면 "C에서 Union이란"으로 검색한다.
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  const DEFAULT_PREFIX = '프로그래밍언어';

  const SEARCH_ENGINES = {
    google: 'https://www.google.com/search?q=',
    naver: 'https://search.naver.com/search.naver?query=',
    duckduckgo: 'https://duckduckgo.com/?q=',
  };

  /**
   * @param {string} term
   * @param {{topic?: string}} [context] topic: 문서에서 추론한 언어/라이브러리 이름 (예: "C")
   */
  function buildSearchQuery(term, context = {}) {
    const t = term.trim();
    if (context.topic) return `${context.topic}에서 ${t}이란`;
    return `${DEFAULT_PREFIX} ${t}`;
  }

  function buildSearchUrl(query, engine = 'google') {
    const base = SEARCH_ENGINES[engine] || SEARCH_ENGINES.google;
    return base + encodeURIComponent(query);
  }

  TFD.buildSearchQuery = buildSearchQuery;
  TFD.buildSearchUrl = buildSearchUrl;
  TFD.SEARCH_ENGINES = SEARCH_ENGINES;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildSearchQuery, buildSearchUrl, SEARCH_ENGINES, DEFAULT_PREFIX };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
