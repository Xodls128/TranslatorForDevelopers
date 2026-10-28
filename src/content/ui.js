/*
 * 화면 요소: 드래그 영역 옆 "번역" 버튼, 상태 알림(토스트)
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
    .button[hidden], .toast[hidden] { display: none; }
    .toast {
      position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; max-width: min(360px, calc(100vw - 32px));
      padding: 8px 12px; border-radius: 6px;
      background: #24292f; color: #fff;
      font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      box-shadow: 0 2px 8px rgba(0, 0, 0, .25);
    }
    .toast.error { background: #b42318; }
  `;

  function createUI({ onTranslate }) {
    const host = document.createElement('div');
    host.id = TFD.UI_HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${STYLE}</style>
      <button class="button" type="button" hidden>번역</button>
      <div class="toast" role="status" hidden></div>`;
    document.documentElement.appendChild(host);

    const button = shadow.querySelector('.button');
    const toast = shadow.querySelector('.toast');
    let toastTimer = null;

    // 버튼을 눌러도 드래그한 선택 영역이 풀리지 않게 한다.
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', (e) => {
      e.preventDefault();
      onTranslate();
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

    function showToast(message, { type = 'info', duration = 3000 } = {}) {
      clearTimeout(toastTimer);
      toast.textContent = message;
      toast.className = `toast ${type === 'error' ? 'error' : ''}`;
      toast.hidden = false;
      if (duration > 0) toastTimer = setTimeout(() => (toast.hidden = true), duration);
    }

    return {
      host,
      contains: (node) => node === host,
      showButton,
      hideButton,
      showToast,
    };
  }

  TFD.createUI = createUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
