/*
 * 공식 한국어판 찾기
 *
 * 페이지가 스스로 밝힌 한국어판 링크만 쓴다.
 *   <link rel="alternate" hreflang="ko" href="…">  (HTML 표준: 이 문서의 번역판)
 *   <a hreflang="ko" href="…">                    (언어 메뉴, 보조)
 * 주소를 추측하지 않는 이유: 그 페이지가 실제로 있는지 확인할 수 없다.
 * (content script의 다른 사이트 요청은 페이지와 같은 출처 제한을 받는다)
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  const KOREAN = /^ko(?:-|$)/i;

  function withoutHash(url) {
    return url.split('#')[0];
  }

  /**
   * @param {Document} doc
   * @returns {string|null} 한국어판 주소. 없거나 지금 페이지가 이미 한국어판이면 null
   */
  function findKoreanEdition(doc = document) {
    if (KOREAN.test(doc.documentElement.lang || '')) return null;
    const here = withoutHash(doc.location ? doc.location.href : '');
    const candidates = [
      ...doc.querySelectorAll('link[rel~="alternate"][hreflang][href]'),
      ...doc.querySelectorAll('a[hreflang][href]'),
    ];
    for (const el of candidates) {
      if (!KOREAN.test(el.getAttribute('hreflang'))) continue;
      const href = el.href; // 상대 주소를 절대 주소로
      if (!/^https?:/.test(href) || withoutHash(href) === here) continue;
      return href;
    }
    return null;
  }

  TFD.findKoreanEdition = findKoreanEdition;
})(typeof globalThis !== 'undefined' ? globalThis : this);
