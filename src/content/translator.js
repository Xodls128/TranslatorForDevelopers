/*
 * Chrome 내장 Translator API (기기 내 번역, 외부 서버/API 키 없음)
 *
 * - Chrome 138 이상 데스크톱에서 동작한다.
 * - 처음 쓸 때 영어→한국어 언어팩을 내려받으며, 다운로드는 사용자 동작(버튼 클릭) 안에서만 시작할 수 있다.
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  const OPTIONS = { sourceLanguage: 'en', targetLanguage: 'ko' };
  let translatorPromise = null;

  class TranslatorUnavailableError extends Error {
    constructor(reason) {
      super(reason);
      this.name = 'TranslatorUnavailableError';
      this.reason = reason;
    }
  }

  /**
   * 버튼 클릭 핸들러 안에서 await 없이 바로 호출해야 한다. (사용자 동작이 유지되어야 다운로드가 시작됨)
   * @param {(loaded: number) => void} [onProgress] 0~1 다운로드 진행률
   */
  function getTranslator(onProgress) {
    if (translatorPromise) return translatorPromise;
    if (!('Translator' in self)) {
      return Promise.reject(new TranslatorUnavailableError('unsupported'));
    }

    translatorPromise = (async () => {
      const availability = await self.Translator.availability(OPTIONS);
      if (availability === 'unavailable') throw new TranslatorUnavailableError('unavailable');
      return self.Translator.create({
        ...OPTIONS,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => onProgress && onProgress(e.loaded));
        },
      });
    })();
    // 실패하면 다음 클릭에서 다시 시도할 수 있게 비운다.
    translatorPromise.catch(() => {
      translatorPromise = null;
    });
    return translatorPromise;
  }

  TFD.getTranslator = getTranslator;
  TFD.TranslatorUnavailableError = TranslatorUnavailableError;
})(typeof globalThis !== 'undefined' ? globalThis : this);
