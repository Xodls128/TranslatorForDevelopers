/*
 * 번역기 진단의 순수 로직 (DOM과 무관, Node 테스트 가능)
 *
 * - 토큰 검사: 번역 결과에서 ⟦n⟧이 빠졌는지, 겹쳤는지, 없는 번호가 생겼는지
 * - 토큰 형식 실험: ⟦0⟧ 대신 [[0]], {0} 같은 형식으로 바꿔 보내고, 돌아온 결과를 다시 ⟦0⟧로 되돌린다
 * - 묶어 번역 실험: 여러 문장을 줄바꿈으로 묶어 보내고, 같은 수의 줄로 돌아오는지 본다
 * - 요약: 토큰 보존율, 번역 시간(첫 문장·평균·중앙값·최대)
 * - 보고서: 채팅에 붙여 넣기 좋은 텍스트
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  const CURRENT_TOKEN = /⟦\s*(\d+)\s*⟧/g;

  // 비교할 토큰 형식. current는 확장이 지금 쓰는 형식이다.
  const TOKEN_FORMATS = {
    current: { label: '⟦0⟧ (지금)', make: (n) => `⟦${n}⟧`, find: /⟦\s*(\d+)\s*⟧/g },
    double: { label: '[[0]]', make: (n) => `[[${n}]]`, find: /\[\[\s*(\d+)\s*\]\]/g },
    brace: { label: '{0}', make: (n) => `{${n}}`, find: /\{\s*(\d+)\s*\}/g },
  };

  /** 지금 형식(⟦n⟧)의 문장을 다른 형식으로 바꾼다. */
  function convertTokens(source, format) {
    const f = TOKEN_FORMATS[format];
    return source.replace(CURRENT_TOKEN, (_, n) => f.make(n));
  }

  /** 다른 형식으로 돌아온 번역 결과를 지금 형식(⟦n⟧)으로 되돌린다. */
  function revertTokens(output, format) {
    const f = TOKEN_FORMATS[format];
    return output.replace(f.find, (_, n) => `⟦${n}⟧`);
  }

  /**
   * @param {string} output 지금 형식(⟦n⟧)의 번역 결과
   * @param {number} count 보낸 토큰 수
   * @returns {{ok: boolean, missing: number[], duplicated: number[], unknown: number[]}}
   */
  function tokenIssues(output, count) {
    const seen = new Array(count).fill(0);
    const unknown = [];
    for (const m of output.matchAll(CURRENT_TOKEN)) {
      const n = Number(m[1]);
      if (n < count) seen[n]++;
      else unknown.push(n);
    }
    const missing = [];
    const duplicated = [];
    seen.forEach((c, n) => {
      if (c === 0) missing.push(n);
      if (c > 1) duplicated.push(n);
    });
    return { ok: !missing.length && !duplicated.length && !unknown.length, missing, duplicated, unknown };
  }

  /** 문제를 사람이 읽을 말로 */
  function describeIssues(issues) {
    if (issues.ok) return '정상';
    const parts = [];
    if (issues.missing.length) parts.push(`누락 ${issues.missing.map((n) => `⟦${n}⟧`).join(' ')}`);
    if (issues.duplicated.length) parts.push(`중복 ${issues.duplicated.map((n) => `⟦${n}⟧`).join(' ')}`);
    if (issues.unknown.length) parts.push(`없는 번호 ${issues.unknown.map((n) => `⟦${n}⟧`).join(' ')}`);
    return parts.join(', ');
  }

  function median(values) {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  /**
   * @param {{tokens: number, ok: boolean, ms: number, timeout?: boolean}[]} rows 예문별 결과 (번역 순서대로)
   * @returns {{total: number, withTokens: number, preserved: number, survival: number|null, firstMs: number|null,
   *   meanMs: number|null, medianMs: number|null, maxMs: number|null, timeouts: number}}
   *   survival: 토큰이 있는 문장 중 모든 토큰이 정확히 한 번씩 돌아온 비율 (0~1)
   */
  function summarize(rows) {
    const timed = rows.filter((r) => !r.timeout).map((r) => r.ms);
    const withTokens = rows.filter((r) => r.tokens > 0);
    const preserved = withTokens.filter((r) => r.ok).length;
    return {
      total: rows.length,
      withTokens: withTokens.length,
      preserved,
      survival: withTokens.length ? preserved / withTokens.length : null,
      firstMs: rows.length && !rows[0].timeout ? rows[0].ms : null,
      meanMs: timed.length ? timed.reduce((a, b) => a + b, 0) / timed.length : null,
      medianMs: median(timed),
      maxMs: timed.length ? Math.max(...timed) : null,
      timeouts: rows.filter((r) => r.timeout).length,
    };
  }

  /** 묶어 번역: 문장들을 줄바꿈으로 묶는다. */
  function joinBatch(sentences) {
    return sentences.join('\n');
  }

  /** 묶어 번역: 결과를 줄로 나눈다. 빈 줄은 버린다. */
  function splitBatch(output) {
    return output.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  }

  const pct = (x) => (x === null ? '-' : `${Math.round(x * 100)}%`);
  const ms = (x) => (x === null || x === undefined ? '-' : `${Math.round(x)}ms`);

  /**
   * 채팅에 붙여 넣을 보고서
   * @param {object} result diagnostics.js가 만든 전체 결과
   */
  function formatReport(result) {
    const s = result.summary;
    const lines = [
      '# 번역기 진단 결과',
      `- 일시: ${result.date}`,
      `- 브라우저: ${result.browser}`,
      `- 번역기 상태: ${result.availability}${result.downloaded ? ' (이번에 다운로드함)' : ''}`,
      `- 번역기 생성 시간: ${ms(result.createMs)}${result.downloaded ? ' (다운로드 포함)' : ''}`,
      `- 토큰 보존율: ${pct(s.survival)} (${s.preserved}/${s.withTokens}문장)`,
      `- 문장당 번역 시간: 첫 문장 ${ms(s.firstMs)}, 평균 ${ms(s.meanMs)}, 중앙값 ${ms(s.medianMs)}, 최대 ${ms(s.maxMs)}${s.timeouts ? `, 시간 초과 ${s.timeouts}문장` : ''}`,
    ];
    if (result.formats) {
      lines.push('', '## 토큰 형식 비교');
      for (const f of result.formats) lines.push(`- ${f.label}: 보존율 ${pct(f.survival)} (${f.preserved}/${f.total}문장)`);
    }
    if (result.batch) {
      const b = result.batch;
      lines.push('', '## 묶어 번역 (3문장씩)',
        `- 문장 수가 그대로 돌아온 묶음: ${b.intact}/${b.groups}`,
        `- 시간: 묶어서 ${ms(b.batchMs)} / 한 문장씩 ${ms(b.singleMs)}`);
    }
    lines.push('', '## 예문별', '', '| # | 분류 | 상태 | 시간 | 원문 | 번역 결과 |', '|---|---|---|---|---|---|');
    result.rows.forEach((r, i) => {
      const cell = (t) => String(t).replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| ${i + 1} | ${r.category} | ${cell(r.status)} | ${ms(r.ms)} | ${cell(r.display)} | ${cell(r.restored || r.output)} |`);
    });
    return lines.join('\n');
  }

  TFD.diagnostics = { TOKEN_FORMATS, convertTokens, revertTokens, tokenIssues, describeIssues, summarize, median, joinBatch, splitBatch, formatReport };

  if (typeof module !== 'undefined' && module.exports) module.exports = TFD.diagnostics;
})(typeof globalThis !== 'undefined' ? globalThis : this);
