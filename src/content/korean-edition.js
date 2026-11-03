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
  // 같은 사이트인가: 같은 주소이거나 한쪽이 다른 쪽의 하위 도메인 (react.dev ↔ ko.react.dev)
  function sameSite(a, b) {
    const strip = (h) => h.replace(/^www\./, '');
    const x = strip(a);
    const y = strip(b);
    return x === y || x.endsWith('.' + y) || y.endsWith('.' + x);
  }

  // 문서와 그 안의 열린 Shadow DOM (MDN 언어 메뉴처럼 웹 컴포넌트 안에 있는 링크도 찾는다)
  function searchRoots(doc) {
    const roots = [doc];
    for (let i = 0; i < roots.length; i++) {
      for (const el of roots[i].querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
    }
    return roots;
  }

  /**
   * @param {Document} doc
   * @returns {string|null} 한국어판 주소. 없거나 지금 페이지가 이미 한국어판이면 null
   *   인정하는 링크: hreflang="ko", 그리고 같은 사이트로 가는 글자가 정확히 "한국어"인 링크 (언어 메뉴)
   */
  function findKoreanEdition(doc = document) {
    if (KOREAN.test(doc.documentElement.lang || '')) return null;
    const here = withoutHash(doc.location ? doc.location.href : '');
    const host = doc.location ? doc.location.hostname : '';
    const usable = (href) => /^https?:/.test(href) && withoutHash(href) !== here;
    const roots = searchRoots(doc);
    for (const root of roots) {
      for (const el of root.querySelectorAll('link[rel~="alternate"][hreflang][href], a[hreflang][href]')) {
        if (KOREAN.test(el.getAttribute('hreflang')) && usable(el.href)) return el.href;
      }
    }
    for (const root of roots) {
      for (const a of root.querySelectorAll('a[href]')) {
        if (a.textContent.trim() !== '한국어' || !usable(a.href)) continue;
        if (sameSite(new URL(a.href).hostname, host)) return a.href;
      }
    }
    return null;
  }

  TFD.findKoreanEdition = findKoreanEdition;
})(typeof globalThis !== 'undefined' ? globalThis : this);
