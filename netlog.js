(() => {
  'use strict';
  if (window.__FS_NETLOG_INIT__) return;
  window.__FS_NETLOG_INIT__ = true;

  const isTop = window.top === window;
  const logs = isTop ? (window.__FS_NETLOG__ = []) : null;
  const MAX_ITEMS = 300;

  const secretKeyRe = /token|password|passwd|secret|authorization|cookie|card|cvv|cvc|pin|captcha|session|signature|credential|bearer|otp/i;
  const watchUrlRe = /purchase|checkout|order|claim|redeem|entitle|acquire|payment|offer|basket|cart|buy/i;
  const REDACTED = '[REDACTED]';

  const scrubToken = (s) =>
    String(s).replace(/[A-Za-z0-9_\-.+/=]{40,}/g, (m) => (/^\/?[0-9a-f]{32,64}$/i.test(m) ? m : REDACTED));

  function maskObj(val, depth = 0) {
    if (depth > 8 || val == null) return val;
    if (Array.isArray(val)) return val.map((v) => maskObj(v, depth + 1));
    if (typeof val === 'object') {
      const out = {};
      for (const k in val) {
        out[k] = secretKeyRe.test(k) ? REDACTED : maskObj(val[k], depth + 1);
      }
      return out;
    }
    return typeof val === 'string' ? scrubToken(val) : val;
  }

  function formatBody(body) {
    try {
      if (body == null) return null;
      if (typeof body === 'string') {
        try { return maskObj(JSON.parse(body)); } catch {}
        if (/^[^=&\s]+=/.test(body)) {
          const out = {};
          new URLSearchParams(body).forEach((v, k) => {
            out[k] = secretKeyRe.test(k) ? REDACTED : scrubToken(v);
          });
          return out;
        }
        return scrubToken(body).slice(0, 1500);
      }
      if (body instanceof URLSearchParams) return formatBody(body.toString());
      if (body instanceof FormData) {
        const out = {};
        body.forEach((v, k) => {
          out[k] = secretKeyRe.test(k) ? REDACTED : typeof v === 'string' ? scrubToken(v) : '[file]';
        });
        return out;
      }
      return Object.prototype.toString.call(body);
    } catch {
      return '[unparsed]';
    }
  }

  function cleanUrl(raw) {
    try {
      const u = new URL(raw, location.href);
      u.searchParams.forEach((_, k) => {
        if (secretKeyRe.test(k)) u.searchParams.set(k, REDACTED);
      });
      return u.href;
    } catch {
      return String(raw);
    }
  }

  function cleanHeaders(h) {
    const out = {};
    try {
      if (!h) return out;
      const put = (k, v) => {
        const key = String(k).toLowerCase();
        out[key] = secretKeyRe.test(key) ? REDACTED : scrubToken(v);
      };
      if (h instanceof Headers) h.forEach((v, k) => put(k, v));
      else if (Array.isArray(h)) h.forEach(([k, v]) => put(k, v));
      else for (const k in h) put(k, h[k]);
    } catch {}
    return out;
  }

  function save(item) {
    if (isTop) {
      logs.push(item);
      if (logs.length > MAX_ITEMS) logs.shift();
    } else {
      try { window.top.postMessage({ __fsNet: item }, '*'); } catch {}
    }
  }

  if (isTop) {
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (d && typeof d === 'object' && d.__fsNet && typeof d.__fsNet === 'object') {
        logs.push({ ...d.__fsNet, viaFrame: true });
        if (logs.length > MAX_ITEMS) logs.shift();
      }
    });
  }

  function pushRecord(kind, method, url, headers, body) {
    if (/^(GET|HEAD)$/i.test(method) && !watchUrlRe.test(url)) return null;
    const item = {
      t: new Date().toISOString().slice(11, 23),
      frame: location.origin,
      kind,
      method: String(method).toUpperCase(),
      url: cleanUrl(url),
      headers: cleanHeaders(headers),
      body: formatBody(body),
    };
    save(item);
    return item;
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    let rec = null;
    try {
      const isReq = typeof Request !== 'undefined' && input instanceof Request;
      const url = isReq ? input.url : String(input && input.url ? input.url : input);
      const method = (init && init.method) || (isReq && input.method) || 'GET';
      const headers = (init && init.headers) || (isReq && input.headers);
      rec = pushRecord('fetch', method, url, headers, init && init.body);
    } catch {}

    const p = origFetch.apply(this, arguments);
    if (rec) {
      p.then((r) => { rec.status = r.status; }).catch((e) => { rec.status = 'ERR ' + (e && e.name); });
    }
    return p;
  };

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  const xhrHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (m, u) {
    this._meta = { m, u, h: {} };
    return xhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (this._meta) this._meta.h[k] = v;
    return xhrHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (this._meta) {
        const rec = pushRecord('xhr', this._meta.m, this._meta.u, this._meta.h, body);
        if (rec) this.addEventListener('loadend', () => { rec.status = this.status; });
      }
    } catch {}
    return xhrSend.apply(this, arguments);
  };

  document.addEventListener('submit', (e) => {
    try {
      const f = e.target;
      pushRecord('form', f.method || 'GET', f.action || location.href, null, new FormData(f));
    } catch {}
  }, true);
})();