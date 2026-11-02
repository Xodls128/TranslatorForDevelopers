'use strict';

/*
 * 번역기 진단 페이지
 *
 * 1. 번역기 상태 확인 (사용 가능 / 다운로드 필요 / 불가 / 미지원)
 * 2. "진단 실행" 클릭 → 번역기 생성 시간 측정 (다운로드가 필요하면 이 클릭으로 받는다)
 * 3. 예문을 확장과 같은 과정(용어 감지 → 토큰 보호 → 번역 → 복원)으로 번역해 토큰 보존율과 시간을 잰다
 * 4. 실험: 토큰 형식 비교([[0]], {0}), 3문장씩 묶어 번역
 * 5. 결과 표시, 복사, 마지막 결과는 이 기기에 저장
 */
(function () {
  const D = TFD.diagnostics;
  const OPTIONS = { sourceLanguage: 'en', targetLanguage: 'ko' };
  const SENTENCE_TIMEOUT_MS = 20000;
  const STORE_KEY = 'diagnostics:last';
  const hasStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  const $ = (id) => document.getElementById(id);
  const stateEl = $('state');
  const progressEl = $('progress');
  const runButton = $('run');
  let lastResult = null;

  const AVAILABILITY_TEXT = {
    available: '사용 가능 (번역 모델이 이 기기에 있음)',
    downloadable: '다운로드 필요 (진단 실행을 누르면 번역 모델을 받습니다)',
    downloading: '다운로드 중',
    unavailable: '이 기기에서는 영어→한국어 번역을 쓸 수 없음',
    unsupported: '이 브라우저에는 내장 번역기가 없음 (데스크톱 Chrome 138 이상 필요)',
  };

  function browserName() {
    const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
    const main = brands.find((b) => /Chrome|Chromium|Edge/.test(b.brand) && !/Not/.test(b.brand));
    return main ? `${main.brand} ${main.version}` : navigator.userAgent;
  }

  async function checkAvailability() {
    if (!('Translator' in self)) return 'unsupported';
    try {
      return await self.Translator.availability(OPTIONS);
    } catch {
      return 'unsupported';
    }
  }

  // 문장 하나 번역 (시간 초과 포함)
  async function timed(translator, text) {
    const t0 = performance.now();
    let timer;
    try {
      const output = await Promise.race([
        translator.translate(text),
        new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), SENTENCE_TIMEOUT_MS))),
      ]);
      return { output, ms: performance.now() - t0, timeout: false };
    } catch (err) {
      return { output: '', ms: performance.now() - t0, timeout: err.message === 'timeout', error: err };
    } finally {
      clearTimeout(timer);
    }
  }

  // 예문의 요소 자리(U+E000~)를 표시용 글자로
  function displayText(sample) {
    return sample.text.replace(/[\ue000-\uf8ff]/g, (ch) => {
      const name = (sample.elements || [])[ch.charCodeAt(0) - 0xe000];
      return name ? `[${name}]` : '[요소]';
    });
  }

  function restoredText(parts, sample) {
    return parts.map((p) => {
      if (p.type === 'text') return p.text;
      if (p.item.kind === 'atom') return `[${(sample.elements || [])[p.item.atomIndex] || '요소'}]`;
      return p.item.text;
    }).join('');
  }

  const detectors = new Map();
  function detectorFor(sample) {
    const key = (sample.packs || []).join(',');
    if (!detectors.has(key)) detectors.set(key, TFD.createTermDetector({ packs: sample.packs || [] }));
    return detectors.get(key);
  }

  function setProgress(text) {
    progressEl.hidden = !text;
    progressEl.textContent = text || '';
  }

  async function run() {
    runButton.disabled = true;
    const samples = TFD.DIAGNOSTIC_SAMPLES;
    const result = { date: new Date().toLocaleString('ko-KR'), browser: browserName(), availability: await checkAvailabilityOnce(), downloaded: false };
    try {
      // 번역기 생성 (다운로드가 필요하면 이 클릭 안에서 시작해야 한다)
      setProgress('번역기 만드는 중…');
      result.downloaded = result.availability === 'downloadable' || result.availability === 'downloading';
      const t0 = performance.now();
      const translator = await self.Translator.create({
        ...OPTIONS,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => setProgress(`번역 모델 다운로드 중… ${Math.round(e.loaded * 100)}%`));
        },
      });
      result.createMs = performance.now() - t0;

      // 1) 지금 형식으로 예문 번역
      result.rows = [];
      for (let i = 0; i < samples.length; i++) {
        const sample = samples[i];
        setProgress(`예문 번역 중… ${i + 1}/${samples.length}`);
        const { source, items } = TFD.protectSentence(sample.text, detectorFor(sample));
        const t = await timed(translator, source);
        const issues = D.tokenIssues(t.output, items.length);
        const restored = t.timeout ? null : TFD.restoreSentence(t.output, items);
        result.rows.push({
          category: sample.category,
          display: displayText(sample),
          source,
          output: t.output,
          restored: restored && restored.ok ? restoredText(restored.parts, sample) : null,
          tokens: items.length,
          ok: !t.timeout && issues.ok,
          status: t.timeout ? '시간 초과' : items.length ? D.describeIssues(issues) : '정상 (토큰 없음)',
          ms: t.ms,
          timeout: t.timeout,
        });
      }
      result.summary = D.summarize(result.rows);

      // 2) 실험: 토큰 형식 비교 (토큰이 있는 예문만)
      const tokenSamples = samples.map((s, i) => ({ s, row: result.rows[i] })).filter((x) => x.row.tokens > 0);
      result.formats = [{ label: D.TOKEN_FORMATS.current.label, total: result.summary.withTokens, preserved: result.summary.preserved, survival: result.summary.survival }];
      for (const format of ['double', 'brace']) {
        let preserved = 0;
        for (let i = 0; i < tokenSamples.length; i++) {
          setProgress(`토큰 형식 ${D.TOKEN_FORMATS[format].label} 실험 중… ${i + 1}/${tokenSamples.length}`);
          const { row } = tokenSamples[i];
          const t = await timed(translator, D.convertTokens(row.source, format));
          if (!t.timeout && D.tokenIssues(D.revertTokens(t.output, format), row.tokens).ok) preserved++;
        }
        result.formats.push({ label: D.TOKEN_FORMATS[format].label, total: tokenSamples.length, preserved, survival: tokenSamples.length ? preserved / tokenSamples.length : null });
      }

      // 3) 실험: 3문장씩 묶어 번역
      const batchRows = samples.map((s, i) => ({ s, row: result.rows[i] })).filter((x) => x.s.batch);
      const groups = [];
      for (let i = 0; i + 3 <= batchRows.length; i += 3) groups.push(batchRows.slice(i, i + 3));
      let intact = 0;
      let batchMs = 0;
      let singleMs = 0;
      for (let g = 0; g < groups.length; g++) {
        setProgress(`묶어 번역 실험 중… ${g + 1}/${groups.length}`);
        const group = groups[g];
        const t = await timed(translator, D.joinBatch(group.map((x) => x.row.source)));
        batchMs += t.ms;
        singleMs += group.reduce((sum, x) => sum + x.row.ms, 0);
        const pieces = D.splitBatch(t.output);
        if (!t.timeout && pieces.length === group.length && pieces.every((p, k) => D.tokenIssues(p, group[k].row.tokens).ok)) intact++;
      }
      result.batch = { groups: groups.length, intact, batchMs, singleMs };

      setProgress('');
      lastResult = result;
      render(result);
      if (hasStorage) chrome.storage.local.set({ [STORE_KEY]: result }).catch(() => {});
    } catch (err) {
      setProgress(`진단을 마치지 못했습니다: ${err && err.name ? err.name + ': ' : ''}${err && err.message ? err.message : err}`);
    } finally {
      runButton.disabled = false;
    }
  }

  let availabilityValue = null;
  async function checkAvailabilityOnce() {
    if (!availabilityValue) availabilityValue = await checkAvailability();
    return availabilityValue;
  }

  const pct = (x) => (x === null ? '-' : `${Math.round(x * 100)}%`);
  const ms = (x) => (x === null || x === undefined ? '-' : `${Math.round(x)}ms`);

  function fillList(el, pairs) {
    el.textContent = '';
    for (const [k, v] of pairs) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      el.append(dt, dd);
    }
  }

  function render(result) {
    const s = result.summary;
    $('results').hidden = false;
    fillList($('summary'), [
      ['일시', result.date],
      ['브라우저', result.browser],
      ['번역기 상태', (AVAILABILITY_TEXT[result.availability] || result.availability) + (result.downloaded ? ' → 이번에 다운로드함' : '')],
      ['번역기 생성 시간', ms(result.createMs) + (result.downloaded ? ' (다운로드 포함)' : '')],
      ['토큰 보존율', `${pct(s.survival)} (${s.preserved}/${s.withTokens}문장)`],
      ['문장당 번역 시간', `첫 문장 ${ms(s.firstMs)} · 평균 ${ms(s.meanMs)} · 중앙값 ${ms(s.medianMs)} · 최대 ${ms(s.maxMs)}${s.timeouts ? ` · 시간 초과 ${s.timeouts}문장` : ''}`],
    ]);
    fillList($('formats'), (result.formats || []).map((f) => [f.label, `${pct(f.survival)} (${f.preserved}/${f.total}문장)`]));
    const b = result.batch;
    fillList($('batch'), b ? [['문장 수가 그대로 돌아온 묶음', `${b.intact}/${b.groups}`], ['시간', `묶어서 ${ms(b.batchMs)} / 한 문장씩 ${ms(b.singleMs)}`]] : []);

    const tbody = $('rows');
    tbody.textContent = '';
    result.rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      const cells = [String(i + 1), r.category, r.status, ms(r.ms), r.display, r.source, r.restored || r.output || '-'];
      cells.forEach((text, k) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (k === 0 || k === 3) td.className = 'num';
        if (k === 2) td.className = r.ok || r.tokens === 0 && !r.timeout ? 'good' : 'bad';
        if (k === 5) td.classList.add('mono');
        tr.append(td);
      });
      tbody.append(tr);
    });
  }

  $('copy').addEventListener('click', async () => {
    if (!lastResult) return;
    const text = D.formatReport(lastResult);
    try {
      await navigator.clipboard.writeText(text);
      $('copied').textContent = '복사했습니다. 채팅에 붙여 넣어 주세요.';
    } catch {
      $('copied').textContent = '복사하지 못했습니다. 아래 표를 직접 선택해 복사해 주세요.';
    }
  });

  runButton.addEventListener('click', () => {
    if (!('Translator' in self)) return;
    run();
  });

  (async () => {
    const a = await checkAvailabilityOnce();
    stateEl.textContent = `번역기 상태: ${AVAILABILITY_TEXT[a] || a}`;
    runButton.disabled = a === 'unsupported' || a === 'unavailable';
    if (hasStorage) {
      try {
        const saved = (await chrome.storage.local.get(STORE_KEY))[STORE_KEY];
        if (saved) {
          lastResult = saved;
          render(saved);
          setProgress(`지난 진단 결과 (${saved.date})를 보여 주고 있습니다. 다시 재려면 진단 실행을 누르세요.`);
        }
      } catch {
        // 저장된 결과가 없거나 읽지 못하면 그냥 둔다.
      }
    }
  })();
})();
