'use strict';

/*
 * 브라우저 테스트가 띄울 브라우저를 한 곳에서 정한다.
 *   TFD_BROWSER 없음 또는 chromium: Playwright가 내려받은 Chromium (기본)
 *   TFD_BROWSER=chrome: 컴퓨터에 설치된 Google Chrome (npm run test:e2e:chrome)
 */
const { chromium } = require('playwright');

const BROWSERS = {
  chromium: {},
  chrome: { channel: 'chrome' },
};

async function launchBrowser() {
  const name = process.env.TFD_BROWSER || 'chromium';
  const options = BROWSERS[name];
  if (!options) throw new Error(`TFD_BROWSER는 ${Object.keys(BROWSERS).join(', ')} 중 하나여야 합니다: ${name}`);
  const browser = await chromium.launch(options);
  console.log(`# browser: ${name} ${browser.version()}`);
  return browser;
}

module.exports = { launchBrowser };
