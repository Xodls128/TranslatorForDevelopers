/*
 * 번역 전 보호 / 번역 후 복원
 *
 * 1. 문장 안의 보호 대상(코드 요소, 개발 용어, 인라인 코드)을 ⟦0⟧, ⟦1⟧ ... 토큰으로 바꾼다.
 * 2. 토큰이 든 문장을 번역기에 넣는다.
 * 3. 번역 결과의 토큰을 원래 항목으로 되돌리고, 토큰 뒤에 붙은 조사를 "은(는)"처럼 병기한다.
 *
 * DOM 요소(<code>, <a> 등)는 문장 텍스트 안에서 사용자 영역 문자(U+E000~)로 표시된다. (text-model.js 참고)
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  const ATOM_BASE = 0xe000;
  const ATOM_MAX = 0xf8ff;
  const ATOM_RE = /[\ue000-\uf8ff]/g;
  const TOKEN_RE = /⟦\s*(\d+)\s*⟧/g;
  const STRAY_ARTICLE_RE = /(^|[^A-Za-z])(?:a|an|the)\s+(?=⟦\s*\d+\s*⟧)/gi;

  function atomChar(index) {
    if (ATOM_BASE + index > ATOM_MAX) throw new Error('Too many atoms in one block');
    return String.fromCharCode(ATOM_BASE + index);
  }

  function atomIndex(ch) {
    return ch.charCodeAt(0) - ATOM_BASE;
  }

  function token(n) {
    return '⟦' + n + '⟧';
  }

  // 조사 규칙: [정규식, 병기형, 받침 있을 때, 받침 없을 때]
  // 앞말이 영어면 받침 유무를 알 수 없으므로 병기형을 쓰고, 앞말이 한글이면 받침으로 하나를 고른다.
  // 뒤에 다른 한글이 이어지면 조사가 아닐 수 있으므로 건드리지 않는다.
  const PARTICLE_RULES = [
    [/^(?:이라는|라는)(?![가-힣])/, '(이)라는', '이라는', '라는'],
    [/^(?:이라고|라고)(?![가-힣])/, '(이)라고', '이라고', '라고'],
    [/^(?:이란|란)(?![가-힣])/, '(이)란', '이란', '란'],
    [/^(?:이나|나)(?![가-힣])/, '(이)나', '이나', '나'],
    [/^(?:으로|로)(?=(?:서|써|부터|는|도|의|만)?(?![가-힣]))/, '(으)로', '으로', '로'],
    [/^(?:은|는)(?![가-힣])/, '은(는)', '은', '는'],
    [/^(?:이|가)(?![가-힣])/, '이(가)', '이', '가'],
    [/^(?:을|를)(?![가-힣])/, '을(를)', '을', '를'],
    [/^(?:과|와)(?![가-힣])/, '과(와)', '과', '와'],
  ];
  const RIEUL = 8; // 받침 ㄹ의 종성 번호. "(으)로"는 ㄹ 받침 뒤에서 "로"가 된다.

  // 한글 음절의 종성 번호 (0이면 받침 없음). 한글이 아니면 null.
  function finalConsonant(ch) {
    const code = ch ? ch.charCodeAt(0) - 0xac00 : -1;
    return code >= 0 && code < 11172 ? code % 28 : null;
  }

  /**
   * @param {string} text 토큰 바로 뒤의 번역문 조각
   * @param {string} [before] 토큰 자리에 들어가는 말. 한글로 끝나면 받침에 맞는 조사 하나를 고른다.
   */
  function fixParticle(text, before = '') {
    const jong = finalConsonant(before.trim().slice(-1));
    for (const [regex, dual, withFinal, withoutFinal] of PARTICLE_RULES) {
      if (!regex.test(text)) continue;
      if (jong === null) return text.replace(regex, dual);
      const hasFinal = jong !== 0 && !(dual === '(으)로' && jong === RIEUL);
      return text.replace(regex, hasFinal ? withFinal : withoutFinal);
    }
    return text;
  }

  /**
   * @param {string} text 문장 (DOM 요소 자리는 U+E000~ 문자)
   * @param {{detect: Function}} detector createTermDetector()의 결과
   * @returns {{source: string, items: object[]}}
   *   source: 번역기에 넣을 문자열, items[n]: 토큰 ⟦n⟧이 가리키는 항목
   *   (items[n].start/end: 원래 문장에서의 위치)
   */
  function protectSentence(text, detector) {
    // 감지기는 요소 자리를 공백으로 본다. (길이가 같아 오프셋은 그대로)
    const spans = detector ? detector.detect(text.replace(ATOM_RE, ' ')) : [];
    const items = [];
    let source = '';
    let spanIndex = 0;

    for (let i = 0; i < text.length; ) {
      const span = spans[spanIndex];
      if (span && span.start === i) {
        source += token(items.length);
        items.push({ kind: span.kind, text: span.text, term: span.term, start: span.start, end: span.end });
        i = span.end;
        spanIndex++;
        continue;
      }
      const ch = text[i];
      if (ch >= '\ue000' && ch <= '\uf8ff') {
        source += token(items.length);
        items.push({ kind: 'atom', atomIndex: atomIndex(ch), start: i, end: i + 1 });
      } else {
        source += ch;
      }
      i++;
    }
    return { source, items };
  }

  /**
   * @param {string} translated 번역기 출력
   * @param {object[]} items protectSentence()의 items
   * @param {(item: object) => string|undefined} [displayText] 항목이 화면에 어떤 말로 들어가는지 (조사 선택용).
   *   없으면 원문 그대로(영어) 들어가는 것으로 보고 조사를 병기한다.
   * @returns {{ok: true, parts: object[]} | {ok: false, reason: string}}
   *   parts: {type: 'text', text} 또는 {type: 'item', item}
   */
  function restoreSentence(translated, items, displayText = () => undefined) {
    // 번역기가 한국어 문장에 영어 관사를 남기는 경우가 있다. ("즉, A ⟦0⟧ 함수는")
    if (/[가-힣]/.test(translated)) translated = translated.replace(STRAY_ARTICLE_RE, '$1');

    const seen = new Array(items.length).fill(0);
    const parts = [];
    let last = 0;

    for (const m of translated.matchAll(TOKEN_RE)) {
      const n = Number(m[1]);
      if (n >= items.length) return { ok: false, reason: 'unknown-token' };
      seen[n]++;
      if (m.index > last) parts.push({ type: 'text', text: translated.slice(last, m.index) });
      parts.push({ type: 'item', item: items[n] });
      last = m.index + m[0].length;
    }
    if (last < translated.length) parts.push({ type: 'text', text: translated.slice(last) });

    if (seen.some((count) => count !== 1)) return { ok: false, reason: 'token-mismatch' };

    for (let i = 1; i < parts.length; i++) {
      if (parts[i].type === 'text' && parts[i - 1].type === 'item') {
        parts[i] = { type: 'text', text: fixParticle(parts[i].text, displayText(parts[i - 1].item)) };
      }
    }
    return { ok: true, parts };
  }

  TFD.atomChar = atomChar;
  TFD.protectSentence = protectSentence;
  TFD.restoreSentence = restoreSentence;
  TFD.fixParticle = fixParticle;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { atomChar, protectSentence, restoreSentence, fixParticle };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
