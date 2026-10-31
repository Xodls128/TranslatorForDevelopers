/*
 * 번역 실패 안내 문구
 *
 * 실패 원인(code)과 상황 정보를 받아 안내 카드에 보여 줄 내용을 만든다.
 * 원인을 확정할 수 없는 경우(다운로드 멈춤 등)는 "~일 수 있습니다"로 쓴다.
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  const INTERNALS_URL = 'chrome://on-device-translation-internals';
  const UPDATE_URL = 'chrome://settings/help';

  /**
   * @param {string} code TranslatorError의 code 또는 'protect-failed'
   * @param {{translated?: number, remaining?: number, failed?: number, stallSeconds?: number, detail?: string}} [info]
   * @returns {{tone: 'error'|'warning', title: string, body: string, fixes: string[], copy: string|null, retry: boolean, detail: string|null}}
   */
  function describeError(code, info = {}) {
    const base = { tone: 'error', body: '', fixes: [], copy: null, retry: false, detail: info.detail || null };
    switch (code) {
      case 'unsupported':
        return {
          ...base,
          title: '이 브라우저는 내장 번역을 지원하지 않습니다',
          body: 'Chrome에 내장된 번역 기능(Translator API)이 필요합니다.',
          fixes: ['데스크톱 Chrome 138 이상으로 업데이트하세요.'],
          copy: UPDATE_URL,
        };
      case 'unavailable':
        return {
          ...base,
          title: '이 기기에서는 영어→한국어 내장 번역을 쓸 수 없습니다',
          body: 'Chrome이 이 기기에서 영어→한국어 번역을 지원하지 않는다고 응답했습니다.',
          fixes: ['언어팩 상태를 확인하세요.'],
          copy: INTERNALS_URL,
        };
      case 'not-allowed':
        return {
          ...base,
          title: '번역기 사용이 허용되지 않았습니다',
          body: 'Chrome이 번역기 생성을 거부했습니다.',
          fixes: [
            '번역 버튼을 다시 눌러 보세요.',
            '계속되면 이 사이트의 정책이 막은 것일 수 있습니다. 다른 페이지에서 시도해 보세요.',
          ],
          retry: true,
        };
      case 'not-supported':
        return {
          ...base,
          title: '영어→한국어 번역 모델을 찾을 수 없습니다',
          fixes: ['Chrome을 최신 버전으로 업데이트한 뒤 다시 시도하세요.'],
          copy: UPDATE_URL,
        };
      case 'offline':
        return {
          ...base,
          title: '인터넷에 연결되어 있지 않아 번역 모델을 받지 못했습니다',
          body: '처음 한 번은 번역 모델을 내려받아야 합니다.',
          fixes: ['인터넷에 연결한 뒤 다시 시도하세요.'],
          retry: true,
        };
      case 'download-stalled':
        return {
          ...base,
          title: '번역 모델 다운로드가 진행되지 않았습니다',
          body: `${info.stallSeconds ?? 30}초 동안 진행이 없어 중단했습니다.`,
          fixes: [
            '회사·학교 네트워크가 구글 다운로드 서버를 막고 있을 수 있습니다. 다른 네트워크에서 시도하세요.',
            '언어팩 상태를 확인하세요.',
          ],
          copy: INTERNALS_URL,
          retry: true,
        };
      case 'sentence-timeout':
        return {
          ...base,
          title: '일부 문장 번역이 응답하지 않아 중단했습니다',
          body: `${info.translated || 0}문장 완료, ${info.remaining || 0}문장 실패.`,
          fixes: ['남은 부분을 다시 드래그해서 번역하세요.'],
          retry: true,
        };
      case 'protect-failed':
        return {
          ...base,
          tone: 'warning',
          title: `${info.failed || 0}문장은 개발 용어 보호 처리에 실패해 원문으로 두었습니다`,
          body: `${info.translated || 0}문장은 정상적으로 번역했습니다.`,
          fixes: ['번역기가 용어 표시를 바꿔 버린 경우입니다. 같은 문장은 다시 시도해도 결과가 같으니 원문 그대로 읽어 주세요.'],
        };
      default:
        return {
          ...base,
          title: '번역 중 알 수 없는 오류가 발생했습니다',
          fixes: ['Chrome을 재시작한 뒤 다시 시도하세요.'],
          retry: true,
        };
    }
  }

  TFD.describeError = describeError;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { describeError, INTERNALS_URL, UPDATE_URL };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
