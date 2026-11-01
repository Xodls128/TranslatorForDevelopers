/*
 * 화면 요소: 드래그 영역 옆 "번역" 버튼, 상태 알림(토스트), 실패 안내 카드
 * 페이지 CSS의 영향을 받지 않도록 Shadow DOM 안에 그린다.
 */
(function (root) {
  'use strict';

  const TFD = (root.TFD = root.TFD || {});

  const STYLE = `
    :host { all: initial; }
    .button {
      position: fixed; z-index: 2147483647;
      padding: 4px 10px; border: 0; border-radius: 6px;
      background: #1f6feb; color: #fff;
      font: 600 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
      box-shadow: 0 2px 8px rgba(0, 0, 0, .25); cursor: pointer;
    }
    .button:hover { background: #1158c7; }
    [hidden] { display: none !important; }
    .toast, .card {
      position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; max-width: min(380px, calc(100vw - 32px));
      box-sizing: border-box; border-radius: 8px; color: #fff;
      font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      box-shadow: 0 4px 16px rgba(0, 0, 0, .3);
    }
    .toast { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #24292f; }
    .toast.error { background: #b42318; }
    .toast .cancel, .card button {
      font: inherit; cursor: pointer; border-radius: 6px;
    }
    .toast .message { word-break: keep-all; overflow-wrap: anywhere; }
    .toast .link { flex: none; color: #8cc4ff; font-weight: 600; text-decoration: underline; white-space: nowrap; }
    .toast .cancel { flex: none; padding: 2px 10px; border: 1px solid rgba(255, 255, 255, .5); background: transparent; color: #fff; }
    .card { padding: 14px 16px; background: #24292f; border-left: 4px solid #f85149; }
    .card.warning { border-left-color: #d29922; }
    .card .head { display: flex; align-items: flex-start; gap: 12px; }
    .card .title { flex: 1; margin: 0; font-size: 14px; font-weight: 700; line-height: 1.4; }
    .card .close { flex: none; width: 24px; height: 24px; padding: 0; border: 0; background: transparent; color: #c9d1d9; font-size: 16px; line-height: 1; }
    .card .body { margin: 6px 0 0; color: #d0d7de; }
    .card .fixes-label { margin: 10px 0 2px; font-weight: 600; }
    .card ul { margin: 0; padding-left: 18px; }
    .card li + li { margin-top: 2px; }
    .card .copy-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .card code { flex: 1; min-width: 0; overflow-wrap: anywhere; padding: 3px 6px; border-radius: 4px; background: rgba(255, 255, 255, .1); font: 12px/1.4 ui-monospace, Menlo, monospace; }
    .card .copy, .card .retry { flex: none; padding: 3px 10px; border: 1px solid rgba(255, 255, 255, .5); background: transparent; color: #fff; }
    .card .retry { background: #1f6feb; border-color: #1f6feb; }
    .card .actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; }
    .card details { color: #c9d1d9; }
    .card summary { cursor: pointer; }
    .card pre { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 11px/1.4 ui-monospace, Menlo, monospace; }
    button:focus-visible, summary:focus-visible { outline: 2px solid #58a6ff; outline-offset: 2px; }
  `;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createUI({ onTranslate }) {
    const host = document.createElement('div');
    host.id = TFD.UI_HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${STYLE}</style>
      <button class="button" type="button" hidden>번역</button>
      <div class="toast" role="status" hidden><span class="message"></span><a class="link" target="_blank" rel="noopener" hidden></a><button class="cancel" type="button" hidden>취소</button></div>
      <div class="card" role="alert" hidden></div>`;
    document.documentElement.appendChild(host);

    const button = shadow.querySelector('.button');
    const toast = shadow.querySelector('.toast');
    const toastMessage = toast.querySelector('.message');
    const toastCancel = toast.querySelector('.cancel');
    const toastLink = toast.querySelector('.link');
    const card = shadow.querySelector('.card');
    let toastTimer = null;
    let onToastCancel = null;

    // 버튼을 눌러도 드래그한 선택 영역이 풀리지 않게 한다.
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', (e) => {
      e.preventDefault();
      onTranslate();
    });
    toastCancel.addEventListener('click', () => {
      if (onToastCancel) onToastCancel();
    });

    // 마우스를 놓은 지점 오른쪽 아래에 띄우고, 화면 밖으로 나가면 반대쪽으로 옮긴다.
    function showButton(point) {
      button.hidden = false;
      const { width, height } = button.getBoundingClientRect();
      const gap = 10;
      let left = point.x + gap;
      let top = point.y + gap;
      if (left + width > window.innerWidth - 8) left = point.x - gap - width;
      if (top + height > window.innerHeight - 8) top = point.y - gap - height;
      button.style.left = `${Math.max(8, left)}px`;
      button.style.top = `${Math.max(8, top)}px`;
    }

    function hideButton() {
      button.hidden = true;
    }

    /**
     * @param {{type?: 'info'|'error', duration?: number, onCancel?: Function, link?: {label: string, href: string}}} [options]
     *   duration 0이면 자동으로 닫지 않음. link: 새 탭으로 여는 링크 하나
     */
    function showToast(message, { type = 'info', duration = 3000, onCancel = null, link = null } = {}) {
      clearTimeout(toastTimer);
      hideCard();
      toastMessage.textContent = message;
      toastLink.hidden = !link;
      if (link) {
        toastLink.textContent = link.label;
        toastLink.href = link.href;
      } else {
        toastLink.removeAttribute('href');
      }
      toast.className = `toast ${type === 'error' ? 'error' : ''}`;
      onToastCancel = onCancel;
      toastCancel.hidden = !onCancel;
      toast.hidden = false;
      if (duration > 0) toastTimer = setTimeout(hideToast, duration);
    }

    function hideToast() {
      clearTimeout(toastTimer);
      toast.hidden = true;
      onToastCancel = null;
    }

    async function copyText(text, codeNode, copyButton) {
      try {
        await navigator.clipboard.writeText(text);
        copyButton.textContent = '복사됨';
      } catch {
        // 클립보드를 쓸 수 없는 페이지에서는 글자를 선택해 두어 직접 복사하게 한다.
        window.getSelection().selectAllChildren(codeNode);
        copyButton.textContent = 'Ctrl+C로 복사';
      }
    }

    /**
     * 실패 안내 카드. 저절로 닫히지 않는다.
     * @param {ReturnType<typeof TFD.describeError>} info
     * @param {{onRetry?: Function}} [actions]
     */
    function showCard(info, { onRetry = null } = {}) {
      hideToast();
      card.replaceChildren();
      card.className = `card ${info.tone === 'warning' ? 'warning' : ''}`;

      const head = el('div', 'head');
      head.append(el('p', 'title', info.title));
      const close = el('button', 'close', '✕');
      close.type = 'button';
      close.setAttribute('aria-label', '닫기');
      close.addEventListener('click', hideCard);
      head.append(close);
      card.append(head);

      if (info.body) card.append(el('p', 'body', info.body));
      if (info.fixes.length) {
        card.append(el('p', 'fixes-label', '해결 방법'));
        const list = el('ul');
        for (const fix of info.fixes) list.append(el('li', '', fix));
        card.append(list);
      }
      if (info.copy) {
        const row = el('div', 'copy-row');
        const code = el('code', '', info.copy);
        const copy = el('button', 'copy', '복사');
        copy.type = 'button';
        copy.addEventListener('click', () => copyText(info.copy, code, copy));
        row.append(code, copy);
        card.append(row);
      }

      const canRetry = !!onRetry && info.retry;
      if (canRetry || info.detail) {
        const actions = el('div', 'actions');
        if (canRetry) {
          const retry = el('button', 'retry', '다시 시도');
          retry.type = 'button';
          retry.addEventListener('click', () => {
            hideCard();
            onRetry();
          });
          actions.append(retry);
        } else {
          actions.append(el('span'));
        }
        if (info.detail) {
          const details = el('details');
          details.append(el('summary', '', '자세히'), el('pre', '', info.detail));
          actions.append(details);
        }
        card.append(actions);
      }
      card.hidden = false;
    }

    function hideCard() {
      card.hidden = true;
    }

    return {
      host,
      contains: (node) => node === host,
      showButton,
      hideButton,
      showToast,
      hideToast,
      showCard,
      hideCard,
    };
  }

  TFD.createUI = createUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
