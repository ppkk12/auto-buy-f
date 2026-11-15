(() => {
  'use strict';

  const html = `
<style>
  :host { all: initial; }
  .panel {
    width: 300px;
    box-sizing: border-box;
    padding: 14px;
    border-radius: 8px;
    color: #e4e4e7;
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", sans-serif;
    background: #111113;
    border: 1px solid #27272a;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  }
  .title {
    margin: 0 0 10px;
    font-size: 13px;
    font-weight: 600;
    color: #fafafa;
    letter-spacing: 0.02em;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 4px 0;
    color: #a1a1aa;
  }
  .row b {
    color: #f4f4f5;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .ok { color: #22c55e !important; }
  .ng { color: #f59e0b !important; }
  .bar {
    height: 4px;
    border-radius: 2px;
    background: #27272a;
    overflow: hidden;
    margin: 10px 0 4px;
  }
  .bar > i {
    display: block;
    height: 100%;
    width: 0;
    background: #3b82f6;
    transition: width 0.15s ease;
  }
  .cnt {
    font-size: 11px;
    color: #71717a;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  input[type="range"] {
    width: 100%;
    margin: 4px 0;
    accent-color: #3b82f6;
  }
  label.chk {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px 0;
    color: #d4d4d8;
    cursor: pointer;
    user-select: none;
  }
  .btns {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  button {
    flex: 1;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 8px 0;
    font: 600 12px inherit;
    color: #fafafa;
    cursor: pointer;
    background: #2563eb;
  }
  button:hover:not(:disabled) {
    background: #1d4ed8;
  }
  button.stop {
    background: #dc2626;
    flex: 0 0 72px;
  }
  button.stop:hover:not(:disabled) {
    background: #b91c1c;
  }
  button.sub {
    background: #18181b;
    border-color: #27272a;
    color: #a1a1aa;
    font-weight: 500;
  }
  button.sub:hover:not(:disabled) {
    background: #27272a;
    color: #e4e4e7;
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .list {
    max-height: 130px;
    overflow-y: auto;
    margin-top: 6px;
    padding: 6px 8px;
    border-radius: 6px;
    background: #09090b;
    border: 1px solid #27272a;
    font-size: 11px;
  }
  .list div {
    padding: 3px 0;
    border-bottom: 1px solid #18181b;
    word-break: break-all;
  }
  .list div:last-child { border-bottom: 0; }
  .list small { color: #71717a; }
  .hide { display: none; }
  .msg {
    margin-top: 8px;
    font-size: 11px;
    color: #71717a;
    line-height: 1.4;
  }
</style>
<div class="panel">
  <div class="title">FREE一括取得</div>
  <div class="row"><span>検出数</span><b id="found">0</b></div>
  <div class="row"><span>テンプレ</span><b id="tpl" class="ng">待機中</b></div>
  <div class="bar"><i id="bar"></i></div>
  <div class="cnt" id="cnt">0 / 0</div>
  <div class="row" style="margin-top:6px"><span>並列数</span><b id="cv">8</b></div>
  <input id="conc" type="range" min="1" max="15" value="8">
  <label class="chk"><input id="dry" type="checkbox" checked>実行前に一覧を確認</label>
  <div id="list" class="list hide"></div>
  <div class="btns">
    <button id="start">取得開始</button>
    <button id="stop" class="stop">停止</button>
  </div>
  <div class="btns">
    <button id="copylog" class="sub">ログをコピー (0)</button>
  </div>
  <div class="msg" id="msg">待機中</div>
</div>`;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function init() {
    const api = window.__FREE_SHOP__;
    if (!api || document.getElementById('fs-panel-root')) return;

    const host = document.createElement('div');
    host.id = 'fs-panel-root';
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = html;

    const $ = (id) => shadow.getElementById(id);
    let previewShown = false;

    function update() {
      const s = api.state;
      const items = api.freeOffers();

      $('found').textContent = items.length;
      $('tpl').textContent = s.template ? 'OK' : '待機中';
      $('tpl').className = s.template ? 'ok' : 'ng';
      $('cnt').textContent = `${s.done} / ${s.total}`;
      $('bar').style.width = (s.total ? (s.done / s.total) * 100 : 0) + '%';
      $('start').disabled = s.running || !s.template || !items.length;
      $('start').textContent = previewShown ? 'この内容で実行' : '取得開始';

      if (s.log.length) {
        $('msg').textContent = s.log[s.log.length - 1];
      }
    }

    function renderList() {
      const box = $('list');
      box.classList.remove('hide');
      const items = api.freeOffers();
      if (!items.length) {
        box.textContent = '対象なし';
        return;
      }
      box.innerHTML = items
        .map((o) => `<div>${esc(o.name)}<br><small>${esc(o.id)}</small></div>`)
        .join('');
    }

    $('conc').addEventListener('input', (e) => {
      $('cv').textContent = e.target.value;
    });

    $('dry').addEventListener('change', () => {
      previewShown = false;
      $('list').classList.add('hide');
      update();
    });

    $('stop').addEventListener('click', () => {
      api.stop();
      previewShown = false;
    });

    $('start').addEventListener('click', () => {
      api.refresh();
      if ($('dry').checked && !previewShown) {
        previewShown = true;
        renderList();
        update();
        return;
      }
      previewShown = false;
      $('list').classList.add('hide');
      api.run(Number($('conc').value));
    });

    setInterval(() => {
      const n = (window.__FS_NETLOG__ || []).length;
      $('copylog').textContent = `ログをコピー (${n})`;
    }, 1000);

    $('copylog').addEventListener('click', async () => {
      const logs = window.__FS_NETLOG__ || [];
      const out = JSON.stringify(logs, null, 2);
      try {
        await navigator.clipboard.writeText(out);
        $('msg').textContent = `ログをコピーしました (${logs.length}件)`;
      } catch {
        console.log(out);
        $('msg').textContent = 'コンソールに出力しました';
      }
    });

    api.subscribe(update);
    update();
    document.documentElement.appendChild(host);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();