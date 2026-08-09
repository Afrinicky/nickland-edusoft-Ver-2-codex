// Tiny JSON HTTP helper for gateway adapters. Supports http + https so tests
// can point a gateway's base URL at a local mock server.
const http = require('http');
const https = require('https');
const { URL } = require('url');

function httpJson(urlStr, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return resolve({ status: 0, error: 'bad_url' }); }
    const lib = u.protocol === 'http:' ? http : https;
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
    try {
      const req = lib.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = null; try { json = data ? JSON.parse(data) : null; } catch (_) {}
          resolve({ status: res.statusCode, data, json });
        });
      });
      req.on('error', (e) => resolve({ status: 0, error: e.message }));
      req.setTimeout(20000, () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
      if (payload) req.write(payload);
      req.end();
    } catch (e) { resolve({ status: 0, error: e.message }); }
  });
}

module.exports = { httpJson };
