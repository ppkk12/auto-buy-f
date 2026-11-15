(() => {
  'use strict';
  if (window.__FREE_SHOP__) return;

  const nativeFetch = window.fetch.bind(window);
  const priceKeyRe = /^(expectedTotalPrice|expectedPrice|totalPrice|finalPrice|price)$/i;
  const giftRe = /gift/i;
  const cashRe = /[$¥€£₩]|\b(USD|JPY|EUR|GBP)\b/;
  const dropHeaders = new Set(['host', 'content-length', 'origin', 'referer', 'cookie']);

  const state = {
    template: null,
    offers: new Map(),
    running: false,
    done: 0,
    total: 0,
    ok: 0,
    failed: 0,
    abort: null,
    log: [],
  };

  const subs = new Set();
  const notify = () => subs.forEach((fn) => { try { fn(); } catch {} });
  const pushLog = (msg) => {
    state.log.push(msg);
    if (state.log.length > 50) state.log.shift();
    notify();
  };

  function unpackStream(arr) {
    const cache = new Map();
    const read = (i) => {
      if (i < 0) return null;
      if (cache.has(i)) return cache.get(i);
      const v = arr[i];
      if (Array.isArray(v)) {
        if (v.length === 2 && typeof v[0] === 'string' && 'DSYB'.includes(v[0])) {
          cache.set(i, v[1]);
          return v[1];
        }
        const list = [];
        cache.set(i, list);
        for (let j = 0; j < v.length; j++) {
          list.push(typeof v[j] === 'number' ? read(v[j]) : v[j]);
        }
        return list;
      }
      if (v && typeof v === 'object') {
        const obj = {};
        cache.set(i, obj);
        for (const k in v) {
          const prop = arr[Number(k.slice(1))];
          const val = v[k];
          obj[prop] = typeof val === 'number' ? read(val) : val;
        }
        return obj;
      }
      return v;
    };
    return read(0);
  }

  function extractOffers(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 30) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) extractOffers(node[i], depth + 1);
      return;
    }
    if (typeof node.offerId === 'string' && node.pricing && typeof node.pricing === 'object') {
      const p = node.pricing;
      const vbucks = p.currencyType === 'MtxCurrency';
      const free = vbucks && Number(p.finalPrice) === 0;
      const owned =
        node.ownershipStatus !== 'unowned' ||
        (node.ownershipLimit != null && Number(node.ownershipCount) >= Number(node.ownershipLimit));
      const raw = JSON.stringify(p) + (node.assetType || '');
      const realMoney = !vbucks || cashRe.test(raw) || giftRe.test(node.offerMainType || '');

      state.offers.set(node.offerId, {
        id: node.offerId,
        slug: node.urlName || null,
        name: node.title || node.englishTitle || node.offerId,
        free,
        owned,
        vbucks,
        realMoney,
      });
      return;
    }
    for (const k in node) extractOffers(node[k], depth + 1);
  }

  const parsedScripts = new WeakSet();

  function parseDomScripts() {
    const scripts = document.scripts;
    for (let i = 0; i < scripts.length; i++) {
      const s = scripts[i];
      if (s.src || parsedScripts.has(s)) continue;
      const m = s.textContent.match(/^\s*window\.__reactRouterContext\.streamController\.enqueue\((".*")\);?\s*$/s);
      if (!m) continue;
      parsedScripts.add(s);
      try {
        extractOffers(unpackStream(JSON.parse(JSON.parse(m[1]))));
      } catch {}
    }
  }

  function parseStreamLines(text) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const data = JSON.parse(line);
        extractOffers(Array.isArray(data) ? unpackStream(data) : data);
      } catch {}
    }
  }

  const getFreeList = () => [...state.offers.values()].filter((o) => o.free && !o.owned && !o.realMoney);

  function refresh() {
    parseDomScripts();
    if (!state.template) {
      const first = getFreeList()[0];
      if (first) {
        state.template = {
          url: location.origin + '/item-shop/purchase.data',
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          kind: 'text',
          payload: new URLSearchParams({ offerId: first.id, expectedTotalPrice: '0' }).toString(),
          ids: [first.id],
          originalId: first.id,
          synthetic: true,
        };
        pushLog('テンプレ初期化完了');
      }
    }
    notify();
  }

  function zeroOutJson(obj, prices = []) {
    if (Array.isArray(obj)) {
      obj.forEach((v) => zeroOutJson(v, prices));
      return prices;
    }
    if (!obj || typeof obj !== 'object') return prices;
    for (const k in obj) {
      if (priceKeyRe.test(k) && typeof obj[k] !== 'object') {
        obj[k] = 0;
        prices.push(obj[k]);
      } else {
        zeroOutJson(obj[k], prices);
      }
    }
    return prices;
  }

  function findPrices(obj, out = []) {
    if (Array.isArray(obj)) {
      obj.forEach((v) => findPrices(v, out));
      return out;
    }
    if (!obj || typeof obj !== 'object') return out;
    for (const k in obj) {
      if (priceKeyRe.test(k) && typeof obj[k] !== 'object') out.push(obj[k]);
      else findPrices(obj[k], out);
    }
    return out;
  }

  function readHeaders(h) {
    const res = {};
    if (!h) return res;
    if (h instanceof Headers) h.forEach((v, k) => { res[k.toLowerCase()] = v; });
    else if (Array.isArray(h)) h.forEach(([k, v]) => { res[String(k).toLowerCase()] = v; });
    else for (const k in h) res[k.toLowerCase()] = h[k];
    return res;
  }

  function readBody(b) {
    if (typeof b === 'string') {
      try { return { kind: 'json', payload: JSON.parse(b) }; }
      catch { return { kind: 'text', payload: b }; }
    }
    if (b instanceof URLSearchParams) return { kind: 'text', payload: b.toString() };
    if (b instanceof FormData) {
      return { kind: 'form', payload: [...b.entries()].filter(([, v]) => typeof v === 'string') };
    }
    return null;
  }

  function tryCapture(url, method, headers, bodyData) {
    try {
      if (state.running || method !== 'POST' || !bodyData) return;
      const u = new URL(url, location.href);
      if (u.origin !== location.origin || giftRe.test(u.href)) return;

      const raw = bodyData.kind === 'text' ? bodyData.payload : JSON.stringify(bodyData.payload);
      if (giftRe.test(raw)) return;

      let decoded = raw;
      try { decoded = decodeURIComponent(raw); } catch {}
      const targetStr = `${u.href} ${raw} ${decoded}`;

      let hit = null;
      for (const o of state.offers.values()) {
        if (targetStr.includes(o.id) || targetStr.includes(encodeURIComponent(o.id)) || (o.slug && targetStr.includes(o.slug))) {
          hit = o;
          break;
        }
      }
      if (!hit) return;
      if (!hit.free) {
        pushLog('有料枠の通信を除外');
        return;
      }

      let prices = [];
      if (bodyData.kind === 'json') prices = findPrices(bodyData.payload);
      else if (bodyData.kind === 'form') prices = bodyData.payload.filter(([k]) => priceKeyRe.test(k)).map(([, v]) => v);
      else {
        for (const [k, v] of new URLSearchParams(bodyData.payload)) {
          if (priceKeyRe.test(k)) prices.push(v);
        }
      }
      if (prices.some((p) => Number(p) !== 0)) return;

      const ids = [hit.id];
      if (hit.slug) ids.push(hit.slug);

      state.template = {
        url: u.href,
        method,
        headers,
        kind: bodyData.kind,
        payload: bodyData.payload,
        ids,
        originalId: hit.id,
        synthetic: false,
      };
      pushLog('購入リクエストをキャプチャ');
    } catch {}
  }

  window.fetch = function (input, init) {
    const isReq = typeof Request !== 'undefined' && input instanceof Request;
    const url = isReq ? input.url : typeof input === 'string' ? input : (input && input.url) || String(input);

    if (isReq) {
      if (!state.running && input.method === 'POST') {
        input.clone().text().then((t) => tryCapture(input.url, 'POST', readHeaders(input.headers), readBody(t))).catch(() => {});
      }
    } else if (init && init.body != null) {
      tryCapture(url, String(init.method || 'GET').toUpperCase(), readHeaders(init.headers), readBody(init.body));
    }

    const p = nativeFetch(input, init);
    p.then((res) => {
      if (!state.running && res.ok && /\.data(\?|$)/.test(url)) {
        res.clone().text().then((t) => { parseStreamLines(t); notify(); }).catch(() => {});
      }
    }).catch(() => {});
    return p;
  };

  async function getCsrf() {
    try {
      const res = await nativeFetch(location.origin + '/item-shop/resources/csrf-token.data', { credentials: 'include' });
      if (!res.ok) return null;
      const text = await res.text();
      let token = null;
      const dig = (n, d) => {
        if (token || !n || typeof n !== 'object' || d > 10) return;
        if (typeof n.csrfToken === 'string') { token = n.csrfToken; return; }
        for (const k in n) dig(n[k], d + 1);
      };
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const arr = JSON.parse(line);
          if (Array.isArray(arr)) dig(unpackStream(arr), 0);
          if (token) break;
        } catch {}
      }
      return token;
    } catch {
      return null;
    }
  }

  function makeReq(offerId) {
    const t = state.template;
    if (!t) throw new Error('テンプレ未設定');

    const offer = state.offers.get(offerId);
    if (!offer || !offer.free || !offer.vbucks || offer.realMoney || offer.owned) {
      throw new Error('対象外アイテム');
    }

    const toIds = [offer.id];
    if (t.ids.length > 1) {
      if (!offer.slug) throw new Error('slugなし');
      toIds.push(offer.slug);
    }

    const swap = (str) => {
      let s = str;
      for (let i = 0; i < t.ids.length; i++) {
        s = s.split(t.ids[i]).join(toIds[i]);
        s = s.split(encodeURIComponent(t.ids[i])).join(encodeURIComponent(toIds[i]));
      }
      return s;
    };

    const url = swap(t.url);
    if (giftRe.test(url)) throw new Error('ギフトURL検知');

    const headers = {};
    for (const [k, v] of Object.entries(t.headers)) {
      if (!dropHeaders.has(k)) headers[k] = v;
    }

    let body;
    if (t.kind === 'json') {
      const copy = JSON.parse(swap(JSON.stringify(t.payload)));
      const checked = zeroOutJson(copy);
      if (checked.some((p) => Number(p) !== 0)) throw new Error('価格チェック失敗');
      body = JSON.stringify(copy);
    } else if (t.kind === 'form') {
      body = new FormData();
      for (const [k, v] of t.payload) body.append(k, priceKeyRe.test(k) ? '0' : swap(v));
      delete headers['content-type'];
    } else {
      const out = new URLSearchParams();
      for (const [k, v] of new URLSearchParams(t.payload)) {
        out.append(k, priceKeyRe.test(k) ? '0' : swap(v));
      }
      if (t.synthetic) {
        if (!state.csrf) throw new Error('CSRF未取得');
        out.set('csrfToken', state.csrf);
      }
      body = out.toString();
    }

    if (typeof body === 'string' && giftRe.test(body)) throw new Error('ギフトパラメータ検知');

    return {
      url,
      init: {
        method: t.method,
        headers,
        body,
        credentials: 'include',
        signal: state.abort.signal,
      },
    };
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function postOffer(id, ctrl) {
    let retriedCsrf = false;
    for (let i = 0; i < 4; i++) {
      if (state.abort.signal.aborted) return false;
      const delay = ctrl.waitUntil - Date.now();
      if (delay > 0) await wait(delay);

      const { url, init } = makeReq(id);
      const res = await nativeFetch(url, init);

      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after'));
        const ms = ra > 0 ? ra * 1000 : 1000 * (2 ** i);
        ctrl.waitUntil = Date.now() + ms + Math.random() * 250;
        ctrl.concurrency = Math.max(1, Math.floor(ctrl.concurrency * 0.7));
        continue;
      }

      state.lastStatus = res.status;
      if (res.ok) {
        const txt = await res.text();
        if (/"success",\s*true/.test(txt)) return true;
      }

      if (state.template.synthetic && !retriedCsrf) {
        retriedCsrf = true;
        const token = await getCsrf();
        if (token) {
          state.csrf = token;
          continue;
        }
      }
      return false;
    }
    return false;
  }

  async function run(limit = 4) {
    if (state.running || !state.template) return;

    const queue = getFreeList()
      .filter((o) => state.template.synthetic || o.id !== state.template.originalId)
      .map((o) => o.id);

    if (state.template.synthetic) {
      state.csrf = await getCsrf();
      if (!state.csrf) {
        pushLog('CSRF取得失敗（要ログイン確認）');
        return;
      }
    }

    state.running = true;
    state.done = 0;
    state.ok = 0;
    state.failed = 0;
    state.total = queue.length;
    state.abort = new AbortController();

    const ctrl = {
      waitUntil: 0,
      concurrency: Math.min(15, Math.max(1, limit)),
    };

    let cursor = 0;
    let inflight = 0;
    notify();

    if (queue.length > 0) {
      let ok = false;
      try {
        ok = await postOffer(queue[cursor++], ctrl);
      } catch (e) {
        pushLog('エラー: ' + e.message);
      }
      state.done++;
      if (ok) state.ok++;
      else state.failed++;

      if (!ok) {
        pushLog(`初回リクエスト失敗のため停止 (HTTP ${state.lastStatus ?? '?'})`);
        state.running = false;
        notify();
        return;
      }
      notify();
    }

    await new Promise((resolve) => {
      const pump = () => {
        if (state.abort.signal.aborted || (cursor >= queue.length && inflight === 0)) {
          resolve();
          return;
        }
        while (inflight < ctrl.concurrency && cursor < queue.length && !state.abort.signal.aborted) {
          const id = queue[cursor++];
          inflight++;
          postOffer(id, ctrl)
            .then((ok) => { if (ok) state.ok++; else state.failed++; })
            .catch(() => { state.failed++; })
            .finally(() => {
              inflight--;
              state.done++;
              notify();
              pump();
            });
        }
      };
      pump();
    });

    state.running = false;
    pushLog(`完了: 成功 ${state.ok} / 失敗 ${state.failed}`);
  }

  window.__FREE_SHOP__ = {
    state,
    freeOffers: getFreeList,
    refresh,
    run,
    stop() {
      if (state.abort) state.abort.abort();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };

  document.addEventListener('DOMContentLoaded', refresh);
  window.addEventListener('load', () => {
    refresh();
    setTimeout(refresh, 2000);
  });
  new MutationObserver(() => {
    clearTimeout(window.__fsTimer);
    window.__fsTimer = setTimeout(refresh, 800);
  }).observe(document, { childList: true, subtree: true });

  refresh();
})();