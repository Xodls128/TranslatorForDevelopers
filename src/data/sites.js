/*
 * 공식 문서 사이트별 설정: 켤 분야 묶음(src/data/terms.js의 TERM_PACKS)과 용어 검색 맥락
 *
 * 검색 맥락은 용어를 클릭했을 때 "React에서 Suspense란"처럼 검색어 앞에 붙는다.
 * 표에 없는 사이트는 기본 사전만 쓰고, 옵션 페이지의 "항상 켤 묶음"으로 보완한다.
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  // host: 이 주소이거나 그 하위 도메인. path: 주소 경로가 이것으로 시작할 때만.
  const SITES = [
    { host: 'react.dev', packs: ['web'], topic: 'React' },
    { host: 'vuejs.org', packs: ['web'], topic: 'Vue' },
    { host: 'nextjs.org', packs: ['web'], topic: 'Next.js' },
    { host: 'developer.mozilla.org', packs: ['web'], topicByPath: [
      [/\/docs\/Web\/JavaScript(?:\/|$)/, 'JavaScript'],
      [/\/docs\/Web\/CSS(?:\/|$)/, 'CSS'],
      [/\/docs\/Web\/HTML(?:\/|$)/, 'HTML'],
      [/\/docs\/Web\/HTTP(?:\/|$)/, 'HTTP'],
      [/\/docs\/Web\/API(?:\/|$)/, 'Web API'],
    ] },
    { host: 'nodejs.org', packs: ['backend'], topic: 'Node.js' },
    { host: 'docs.python.org', packs: ['backend'], topic: 'Python' },
    { host: 'docs.spring.io', packs: ['backend'], topic: 'Spring' },
    { host: 'go.dev', packs: ['backend'], topic: 'Go' },
    { host: 'kubernetes.io', packs: ['backend'], topic: 'Kubernetes' },
    { host: 'docs.docker.com', packs: ['backend'], topic: 'Docker' },
    { host: 'doc.rust-lang.org', packs: ['systems'], topic: 'Rust' },
    { host: 'docs.kernel.org', packs: ['systems'], topic: '리눅스 커널' },
    { host: 'llvm.org', packs: ['systems'], topic: 'LLVM' },
    { host: 'docs.espressif.com', packs: ['embedded'], topic: 'ESP-IDF' },
    { host: 'docs.zephyrproject.org', packs: ['embedded'], topic: 'Zephyr' },
    { host: 'docs.arduino.cc', packs: ['embedded'], topic: 'Arduino' },
    { host: 'raspberrypi.com', path: '/documentation', packs: ['embedded'], topic: 'Raspberry Pi' },
  ];

  /**
   * @param {string} hostname 예: "www.raspberrypi.com"
   * @param {string} [pathname] 예: "/documentation/computers/"
   * @returns {{packs: string[], topic: string}} 표에 없으면 빈 묶음과 빈 맥락
   */
  function resolveSite(hostname, pathname = '/') {
    const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
    for (const site of SITES) {
      if (host !== site.host && !host.endsWith('.' + site.host)) continue;
      if (site.path && !pathname.startsWith(site.path)) continue;
      let topic = site.topic || '';
      for (const [pattern, name] of site.topicByPath || []) {
        if (pattern.test(pathname)) { topic = name; break; }
      }
      return { packs: site.packs.slice(), topic };
    }
    return { packs: [], topic: '' };
  }

  TFD.SITES = SITES;
  TFD.resolveSite = resolveSite;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SITES, resolveSite };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
