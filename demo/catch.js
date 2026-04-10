/**
 * Demo callback catcher + login launcher.
 *
 * GET /          → shows a "Login with Discord" button
 * GET /?code=... → shows the auth code (OAuth callback success)
 *
 * Usage: node catch.js
 */

const http = require('http');

const FA_URL    = process.env.FA_URL    || 'http://localhost:9011';
const CLIENT_ID = process.env.FA_APP_ID || 'e9fdb985-9173-4e01-9d73-ac2d60d1dc8e';
const IDP_ID    = process.env.FA_IDP_ID || '26a74a08-53fc-4e85-bd84-b1f799dcacdc';
const REDIRECT  = 'http://localhost:3000';

// idp_hint skips FusionAuth's own login screen and goes straight to Discord
const loginUrl =
  `${FA_URL}/oauth2/authorize` +
  `?client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
  `&response_type=code` +
  `&scope=openid+email+profile` +
  `&idp_hint=${IDP_ID}`;

http.createServer((req, res) => {
  const url  = new URL(req.url, `http://localhost:3000`);
  const code = url.searchParams.get('code');

  res.writeHead(200, { 'Content-Type': 'text/html' });

  if (code) {
    res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Discord Login — Success</title>
<style>body{font-family:system-ui,sans-serif;max-width:600px;margin:80px auto;padding:0 20px;background:#f5f5f5;}
.card{background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,.08);}
h1{color:#2d7d2f;margin-top:0;}pre{background:#f0f0f0;padding:12px;border-radius:6px;word-break:break-all;white-space:pre-wrap;font-size:13px;}
a{color:#5865F2;}</style></head>
<body><div class="card">
<h1>✅ Logged in via Discord</h1>
<p>OAuth callback received. Auth code:</p>
<pre>${code}</pre>
<p><a href="/">← Log in again</a> &nbsp;|&nbsp; <a href="${FA_URL}/admin" target="_blank">Open FusionAuth admin →</a></p>
</div></body></html>`);
  } else {
    res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>FusionAuth × Discord Demo</title>
<style>body{font-family:system-ui,sans-serif;max-width:600px;margin:80px auto;padding:0 20px;background:#f5f5f5;text-align:center;}
.card{background:#fff;border-radius:12px;padding:48px 32px;box-shadow:0 2px 12px rgba(0,0,0,.08);}
h1{margin-top:0;font-size:24px;}p{color:#555;}
.btn{display:inline-block;background:#5865F2;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:16px;font-weight:600;margin-top:16px;}
.btn:hover{background:#4752c4;}</style></head>
<body><div class="card">
<h1>FusionAuth × Discord</h1>
<p>Turnkey Discord login — powered by a reconcile lambda that maps avatar URLs,<br>display names, locale, and full profile data into FusionAuth.</p>
<a class="btn" href="${loginUrl}">Login with Discord</a>
<p style="margin-top:32px;font-size:13px;color:#999;"><a href="${FA_URL}/admin" target="_blank">FusionAuth admin</a></p>
</div></body></html>`);
  }
}).listen(3000, () => {
  console.log('\n🚀  Demo server ready');
  console.log(`\n   Login page:  http://localhost:3000`);
  console.log(`   FA admin:    ${FA_URL}/admin\n`);
});
