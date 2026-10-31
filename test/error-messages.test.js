'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { describeError, INTERNALS_URL, UPDATE_URL } = require('../src/core/error-messages');

test('describeError: 원인별 제목, 다시 시도 가능 여부, 복사할 주소', () => {
  const cases = [
    ['unsupported', '이 브라우저는 내장 번역을 지원하지 않습니다', false, UPDATE_URL],
    ['unavailable', '이 기기에서는 영어→한국어 내장 번역을 쓸 수 없습니다', false, INTERNALS_URL],
    ['not-allowed', '번역기 사용이 허용되지 않았습니다', true, null],
    ['not-supported', '영어→한국어 번역 모델을 찾을 수 없습니다', false, UPDATE_URL],
    ['offline', '인터넷에 연결되어 있지 않아 번역 모델을 받지 못했습니다', true, null],
    ['download-stalled', '번역 모델 다운로드가 진행되지 않았습니다', true, INTERNALS_URL],
    ['sentence-timeout', '일부 문장 번역이 응답하지 않아 중단했습니다', true, null],
    ['unknown', '번역 중 알 수 없는 오류가 발생했습니다', true, null],
  ];
  for (const [code, title, retry, copy] of cases) {
    const info = describeError(code);
    assert.equal(info.title, title, code);
    assert.equal(info.retry, retry, code);
    assert.equal(info.copy, copy, code);
    assert.equal(info.tone, 'error', code);
    assert.ok(info.fixes.length > 0, code);
  }
});

test('describeError: 상황 정보가 문구에 들어간다', () => {
  assert.equal(describeError('download-stalled', { stallSeconds: 30 }).body, '30초 동안 진행이 없어 중단했습니다.');
  assert.equal(describeError('sentence-timeout', { translated: 2, remaining: 3 }).body, '2문장 완료, 3문장 실패.');
  const protect = describeError('protect-failed', { translated: 4, failed: 1 });
  assert.equal(protect.title, '1문장은 개발 용어 보호 처리에 실패해 원문으로 두었습니다');
  assert.equal(protect.tone, 'warning');
  assert.equal(protect.retry, false);
});

test('describeError: 모르는 원인은 알 수 없는 오류로, 자세한 내용을 함께 보여 준다', () => {
  const info = describeError('something-new', { detail: 'OperationError: boom' });
  assert.equal(info.title, '번역 중 알 수 없는 오류가 발생했습니다');
  assert.equal(info.detail, 'OperationError: boom');
});
