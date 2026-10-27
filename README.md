# Translator for Developers

개발 용어와 코드는 영어 그대로 두고, **드래그한 영어 문장만** 한국어로 번역하는 Chrome 확장 프로그램입니다.
번역은 Chrome 내장 Translator API(기기 내 번역)로 처리하므로 외부 서버, API 키, 비용이 없습니다.

## 사용법

| 동작 | 결과 |
|---|---|
| 번역되지 않은 영어를 드래그 | `번역` 버튼 표시 → 누르면 드래그가 걸친 문장들을 번역 |
| 번역된 문장(옅은 노란 배경)을 드래그 | 걸친 문장들이 바로 원문으로 복원 |
| 번역문 속 점선 밑줄 용어를 클릭 | `프로그래밍언어 <용어>` 검색 결과를 새 탭으로 열기 |

- 코드(`<code>`, `<pre>`, `<kbd>` …)와 태그 없이 섞인 코드 조각(`useState()`, `max_retries`, `config.yaml`, `--save-dev` …)은 번역하지 않습니다.
- 개발 용어는 영어로 남기고 뒤 조사는 `closure은(는)`처럼 병기합니다.
- 옵션 페이지에서 보존할 용어 추가/제외, 검색 엔진(Google/Naver/DuckDuckGo)을 설정할 수 있습니다.

## 설치 (개발 모드)

1. 데스크톱 Chrome 138 이상을 준비합니다.
2. `chrome://extensions` → 우측 상단 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드합니다** → 이 저장소 폴더 선택
4. 처음 번역할 때 영어→한국어 언어팩을 내려받습니다. (진행률이 우측 하단에 표시됨)

## 동작 방식

```
드래그 (Selection Range)
  → 선택 영역을 감싸는 블록 요소를 찾는다
  → 블록 아래 인라인 내용을 평평한 텍스트(run)로 펼친다          src/content/text-model.js
      · 글자마다 원래 DOM 위치(텍스트 노드+오프셋)를 기억
      · <code>, <a> 등은 한 글자(U+E000~)로 표시, <pre>/블록 경계는 run을 끊음
      · <br>과 줄바꿈은 공백 (한 문장은 줄바꿈으로 나뉘지 않음)
  → 문장 분할 (Intl.Segmenter + 약어 보정)                        src/core/sentence-splitter.js
  → 선택 영역이 걸친 문장만 고른다
  → 용어/코드/요소를 ⟦0⟧ 토큰으로 보호                            src/core/term-detector.js, protector.js
  → Translator API로 문장별 번역                                   src/content/translator.js
  → 토큰 복원 + 조사 병기
  → 문장의 원래 DOM 조각을 떼어 보관하고 그 자리에
    <span class="tfd-sentence" data-tfd-id="n">번역문</span> 삽입   src/content/sentence-dom.js
복원: data-tfd-id(문장 번호)로 보관한 원래 DOM 조각을 다시 끼워 넣음
```

원래 DOM을 그 자리에서 바꾸기 때문에 주변 요소와 CSS가 그대로 유지되고, 복원하면 원래 HTML과 동일해집니다.

## 디렉터리

```
manifest.json
src/
  core/        DOM과 무관한 순수 로직 (Node 테스트 가능)
  content/     content script (DOM, UI, Translator API)
  data/        개발 용어 사전
  options/     옵션 페이지
test/
  *.test.js    단위 테스트 (문장 분할 회귀 세트 포함)
  e2e/         Chromium에서 드래그→번역→복원 흐름 테스트 (가짜 번역기 사용)
```

## 테스트

```bash
npm test          # 단위 테스트
npm run test:e2e  # Playwright + Chromium 필요
```

문장을 잘못 자르는 사례를 발견하면 `test/sentence-splitter.test.js`의 `CASES`에 추가하세요.

## 알려진 한계 / 다음 단계

- **토큰 보존 검증 필요**: 실제 Chrome Translator API가 `⟦0⟧` 토큰을 얼마나 잘 보존하는지는 아직 실측하지 않았습니다.
  토큰이 사라지거나 중복되면 그 문장은 원문으로 두고 알림에 실패 개수를 표시합니다.
- **링크(`<a>`)는 원문 유지**: 링크 기능을 살리기 위해 링크 텍스트는 번역하지 않습니다.
- **`<strong>`, `<em>` 등 강조는 번역문에서 사라짐**: 텍스트는 번역되지만 강조 서식은 빠집니다. 복원하면 되돌아옵니다.
- **다의어 용어**: `union`, `class` 같은 단어는 문장 중간 대문자형 / 제목형 문장 / 뒤에 `type`·`keyword` 등 단서가 올 때만 보존합니다.
  일반 문장의 첫 단어로 오면 번역될 수 있습니다.
- 검색어 맥락 추론(`C에서 Union이란`): `buildSearchQuery(term, { topic })`에 자리를 마련해 두었습니다.
- 어구 단위 일대일 매칭 복원은 추후 확장 과제입니다.
