/*
 * Chrome 내장 Translator API (기기 내 번역, 외부 서버/API 키 없음)
 *
 * - Chrome 138 이상 데스크톱에서 동작한다.
 * - 처음 쓸 때 영어→한국어 언어팩을 내려받으며, 다운로드는 사용자 동작(버튼 클릭) 안에서만 시작할 수 있다.
 * - 멈춤 대책: 다운로드 진행이 일정 시간 없거나, 문장 하나가 일정 시간 안에 끝나지 않으면 중단한다.
 *   사용자가 취소하면 진행 중인 작업을 AbortController로 실제로 멈춘다.
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  const OPTIONS = { sourceLanguage: 'en', targetLanguage: 'ko' };
  // 테스트에서 짧게 바꿀 수 있도록 TFD에 둔다.
  const TIMEOUTS = { downloadStallMs: 30000, sentenceMs: 20000 };
  let translator = null; // 만들기에 성공한 번역기만 보관한다. 실패하면 다음 클릭에서 새로 시도.

  /**
   * code: unsupported | unavailable | not-allowed | not-supported | offline |
   *       download-stalled | sentence-timeout | cancelled | unknown
   */
  class TranslatorError extends Error {
    constructor(code, cause) {
      super(code);
      this.name = 'TranslatorError';
      this.code = code;
      this.cause = cause;
    }
  }

  function toTranslatorError(err, signal) {
    if (err instanceof TranslatorError) return err;
    if (signal && signal.aborted && signal.reason instanceof TranslatorError) return signal.reason;
    if (err && err.name === 'NotAllowedError') return new TranslatorError('not-allowed', err);
    if (err && err.name === 'NotSupportedError') return new TranslatorError('not-supported', err);
    return new TranslatorError('unknown', err);
  }

  // API가 취소 신호를 무시하더라도 기다림이 끝나도록 신호와 경주시킨다.
  function untilAborted(promise, signal) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    ]);
  }

  // 바깥(사용자 취소) 신호가 오면 안쪽 작업을 'cancelled'로 멈춘다. 연결을 끊는 함수를 돌려준다.
  function linkCancel(outer, controller) {
    if (!outer) return () => {};
    const onAbort = () => controller.abort(new TranslatorError('cancelled'));
    if (outer.aborted) onAbort();
    else outer.addEventListener('abort', onAbort, { once: true });
    return () => outer.removeEventListener('abort', onAbort);
  }

  /**
   * 버튼 클릭 핸들러 안에서 await 없이 바로 호출해야 한다. (사용자 동작이 유지되어야 다운로드가 시작됨)
   * @param {{onProgress?: (loaded: number) => void, signal?: AbortSignal}} [options]
   */
  async function getTranslator({ onProgress, signal } = {}) {
    if (translator) return translator;
    if (!('Translator' in self)) throw new TranslatorError('unsupported');

    const controller = new AbortController();
    const unlink = linkCancel(signal, controller);
    let stallTimer = null;
    // 진행률 이벤트가 올 때마다 다시 잰다. 일정 시간 아무 진행이 없으면 멈춘 것으로 본다.
    const watchStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        const code = navigator.onLine === false ? 'offline' : 'download-stalled';
        controller.abort(new TranslatorError(code));
      }, TIMEOUTS.downloadStallMs);
    };

    try {
      const availability = await untilAborted(self.Translator.availability(OPTIONS), controller.signal);
      if (availability === 'unavailable') throw new TranslatorError('unavailable');
      watchStall();
      const creating = self.Translator.create({
        ...OPTIONS,
        signal: controller.signal,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            watchStall();
            if (onProgress) onProgress(e.loaded);
          });
        },
      });
      translator = await untilAborted(creating, controller.signal);
      return translator;
    } catch (err) {
      throw toTranslatorError(err, controller.signal);
    } finally {
      clearTimeout(stallTimer);
      unlink();
    }
  }

  /** 문장 하나를 번역한다. 제한 시간을 넘기면 'sentence-timeout', 사용자가 취소하면 'cancelled'. */
  async function translateText(activeTranslator, text, signal) {
    const controller = new AbortController();
    const unlink = linkCancel(signal, controller);
    const timer = setTimeout(() => controller.abort(new TranslatorError('sentence-timeout')), TIMEOUTS.sentenceMs);
    try {
      return await untilAborted(activeTranslator.translate(text, { signal: controller.signal }), controller.signal);
    } catch (err) {
      throw toTranslatorError(err, controller.signal);
    } finally {
      clearTimeout(timer);
      unlink();
    }
  }

  TFD.TRANSLATOR_TIMEOUTS = TIMEOUTS;
  TFD.getTranslator = getTranslator;
  TFD.translateText = translateText;
  TFD.TranslatorError = TranslatorError;
})(typeof globalThis !== 'undefined' ? globalThis : this);
