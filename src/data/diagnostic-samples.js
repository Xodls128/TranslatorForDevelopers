/*
 * 번역기 진단 예문
 *
 * 실제 확장과 같은 과정(용어 감지 → 토큰 보호 → 번역 → 복원)으로 번역해서 토큰 보존율과 번역 시간을 잰다.
 * 페이지 요소(<code>, <a>) 자리는 실제 페이지처럼 U+E000부터의 문자로 넣는다. elements는 그 자리에 들어갈 글자(표시용).
 * batch: true인 예문은 "묶어 번역" 실험에도 쓴다. (요소 자리가 없는 문장만)
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  const DIAGNOSTIC_SAMPLES = [
    // 기본 (토큰 없음): 기준 속도와 품질
    { category: '기본', text: 'This guide explains how the build process works.', batch: true },
    { category: '기본', text: 'Read the following section before you continue.', batch: true },
    { category: '기본', text: 'Most applications only need a small part of this feature.', batch: true },
    { category: '기본', text: 'You can safely skip this step if you are new to the topic.', batch: true },
    { category: '기본', text: 'The examples below show the most common patterns.', batch: true },

    // 용어 1~3개
    { category: '용어', text: 'A closure gives you access to an outer function scope.', batch: true },
    { category: '용어', text: 'The function returns a Promise that resolves later.', batch: true },
    { category: '용어', text: 'Use a callback when the operation finishes.', batch: true },
    { category: '용어', text: 'React calls your component again after every render.', batch: true },
    { category: '용어', text: 'The runtime creates a new iterator for each loop.', batch: true },
    { category: '용어', text: 'Each middleware can modify the payload before the endpoint sees it.', batch: true },

    // 토큰 많음: 보존율이 가장 흔들릴 만한 경우
    { category: '토큰 많음', text: 'Call useState() and useEffect() inside the component, then pass props and a callback to the child through React context.' },
    { category: '토큰 많음', text: 'Set max_retries and timeout_ms in config.yaml, then run npm install --save-dev and restart Node.js.' },
    { category: '토큰 많음', text: 'The closure captures the iterator, the callback, and the Promise returned by fetch().' },
    { category: '토큰 많음', text: 'Write 0xFF to GPIOA_MODER, wait 10 ms, then read bits [31:16] from the CR1 register.' },

    // 코드 조각
    { category: '코드 조각', text: 'Call fetch() to send the request.', batch: true },
    { category: '코드 조각', text: 'Add the setting to config.yaml in the project root.', batch: true },
    { category: '코드 조각', text: 'Run the command with --save-dev to add it as a dev dependency.', batch: true },
    { category: '코드 조각', text: 'The fetchData helper reads the API key from process.env.', batch: true },
    { category: '코드 조각', text: 'Rename my_variable to user_count before you commit.', batch: true },

    // 로우레벨·하드웨어
    { category: '로우레벨', text: 'Set the register to 0xFF to enable all pins.', packs: ['embedded'] },
    { category: '로우레벨', text: 'Bits [31:16] are reserved and must be kept at reset value.', packs: ['embedded'] },
    { category: '로우레벨', text: 'Supply voltage must not exceed 3.3V on any pin.', packs: ['embedded'] },
    { category: '로우레벨', text: 'Each pin can source up to 16 mA of current.', packs: ['embedded'] },
    { category: '로우레벨', text: 'Version 5.1 adds support for ESP32-C6 and other chips.', packs: ['embedded'] },
    { category: '로우레벨', text: 'The call returns -EINVAL if the argument is invalid.', packs: ['systems'] },

    // 페이지 요소 자리 (<code>, <a>)
    { category: '페이지 요소', text: 'Call \ue000 inside the component.', elements: ['useEffect()'] },
    { category: '페이지 요소', text: 'See \ue000 for more details about the options.', elements: ['the configuration guide'] },
    { category: '페이지 요소', text: 'Both \ue000 and \ue001 return a new array.', elements: ['map()', 'filter()'] },
    { category: '페이지 요소', text: 'If \ue000 is true, the value is cached in \ue001 until the next reload.', elements: ['options.cache', 'localStorage'] },

    // 조사 병기 결과 확인
    { category: '조사', text: 'A closure is created when the function is defined.' },
    { category: '조사', text: 'The Promise is rejected when the request fails.' },
    { category: '조사', text: 'Pass the callback to the constructor.' },

    // 경고 상자 라벨
    { category: '상자 라벨', text: 'Note' },
    { category: '상자 라벨', text: 'See also' },

    // 코드 주석
    { category: '코드 주석', text: 'This is a reactive value', batch: true },
    { category: '코드 주석', text: 'expose the ref to the template', batch: true },
    { category: '코드 주석', text: 'The pod template ends here', batch: true },

    // 긴 문장
    { category: '긴 문장', text: 'When you pass a function as the second argument, React will call it after the component has been rendered and the browser has painted the screen, which means that any code inside it will not block the user from seeing the updated interface.' },
    { category: '긴 문장', text: 'If the peripheral clock is disabled while a transfer is in progress, the controller stops immediately, the pending interrupt is cleared, and the data that was already written to the buffer may be lost unless the driver saves it first.', packs: ['embedded'] },
  ];

  TFD.DIAGNOSTIC_SAMPLES = DIAGNOSTIC_SAMPLES;

  if (typeof module !== 'undefined' && module.exports) module.exports = { DIAGNOSTIC_SAMPLES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
