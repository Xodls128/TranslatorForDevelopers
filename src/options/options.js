'use strict';

const DEFAULTS = {
  extraTerms: [],
  excludedTerms: [],
  searchEngine: 'google',
  saveTranslations: true,
  packsAuto: true,
  packsAlways: [],
  koreanEdition: true,
};

const fields = {
  extraTerms: document.getElementById('extraTerms'),
  excludedTerms: document.getElementById('excludedTerms'),
  searchEngine: document.getElementById('searchEngine'),
  saveTranslations: document.getElementById('saveTranslations'),
  packsAuto: document.getElementById('packsAuto'),
  koreanEdition: document.getElementById('koreanEdition'),
};

// 분야 묶음 체크박스 (src/data/terms.js의 TERM_PACK_LABELS 순서)
const packBoxes = {};
for (const [name, label] of Object.entries(TFD.TERM_PACK_LABELS)) {
  const wrap = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'pack-' + name;
  wrap.htmlFor = box.id;
  wrap.append(box, label);
  document.getElementById('packsAlways').appendChild(wrap);
  packBoxes[name] = box;
}

// 번역 결과 기기 저장소 (content script와 같은 확장 전용 공간)
const store = TFD.createTranslationStore({ storage: chrome.storage.local });
const usage = document.getElementById('usage');

function toLines(text) {
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}

async function showUsage() {
  const { entries, bytes } = await store.usage();
  usage.textContent = `${entries.toLocaleString()}개 문장 저장됨 (${Math.round(bytes / 1024).toLocaleString()}KB / 최대 8MB)`;
}

chrome.storage.sync.get(DEFAULTS).then((values) => {
  fields.extraTerms.value = values.extraTerms.join('\n');
  fields.excludedTerms.value = values.excludedTerms.join('\n');
  fields.searchEngine.value = values.searchEngine;
  fields.saveTranslations.checked = values.saveTranslations;
  fields.packsAuto.checked = values.packsAuto;
  fields.koreanEdition.checked = values.koreanEdition;
  for (const [name, box] of Object.entries(packBoxes)) box.checked = values.packsAlways.includes(name);
});
showUsage();

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({
    extraTerms: toLines(fields.extraTerms.value),
    excludedTerms: toLines(fields.excludedTerms.value),
    searchEngine: fields.searchEngine.value,
    saveTranslations: fields.saveTranslations.checked,
    packsAuto: fields.packsAuto.checked,
    koreanEdition: fields.koreanEdition.checked,
    packsAlways: Object.keys(packBoxes).filter((name) => packBoxes[name].checked),
  });
  const status = document.getElementById('status');
  status.textContent = '저장했습니다.';
  setTimeout(() => (status.textContent = ''), 2000);
});

document.getElementById('clearTranslations').addEventListener('click', async () => {
  const removed = await store.clear();
  usage.textContent = `${removed.toLocaleString()}개 문장을 지웠습니다.`;
  setTimeout(showUsage, 2000);
});
