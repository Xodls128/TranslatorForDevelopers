'use strict';

const DEFAULTS = { extraTerms: [], excludedTerms: [], searchEngine: 'google' };

const fields = {
  extraTerms: document.getElementById('extraTerms'),
  excludedTerms: document.getElementById('excludedTerms'),
  searchEngine: document.getElementById('searchEngine'),
};

function toLines(text) {
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}

chrome.storage.sync.get(DEFAULTS).then((values) => {
  fields.extraTerms.value = values.extraTerms.join('\n');
  fields.excludedTerms.value = values.excludedTerms.join('\n');
  fields.searchEngine.value = values.searchEngine;
});

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({
    extraTerms: toLines(fields.extraTerms.value),
    excludedTerms: toLines(fields.excludedTerms.value),
    searchEngine: fields.searchEngine.value,
  });
  const status = document.getElementById('status');
  status.textContent = '저장했습니다.';
  setTimeout(() => (status.textContent = ''), 2000);
});
