const express = require('express');
const path    = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const ALLOWED_ORIGIN       = process.env.ALLOWED_ORIGIN || '*';
const REDIRECT_URI         = 'https://survey-access-proxy.onrender.com/auth/callback';

let accessToken  = null;
let refreshToken = process.env.GOOGLE_REFRESH_TOKEN || null;
let tokenExpiry  = 0;

// Security + COOP/COEP headers required for SharedArrayBuffer (WASM threading)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Content-Type');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

// Serve built app from public/
app.use(express.static(path.join(__dirname, 'public')));

// Token management - Google refresh tokens do NOT rotate
async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;
  if (!refreshToken) throw new Error('No refresh token - visit /auth to connect Google Drive');
  console.log('[token] Refreshing...');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken
    })
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) throw new Error('Token refresh failed: ' + (data.error_description || data.error || JSON.stringify(data)));
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  console.log('[token] Refreshed OK');
  return accessToken;
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', connected: !!refreshToken, hasToken: !!accessToken });
});

// Auth
app.get('/auth', (req, res) => {
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/drive.readonly',
    access_type:   'offline',
    prompt:        'consent'
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params);
});

app.get('/auth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Missing code');
  try {
    const result = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        redirect_uri:  REDIRECT_URI
      })
    });
    const data = await result.json();
    if (!result.ok || !data.access_token) throw new Error(data.error_description || JSON.stringify(data));
    accessToken  = data.access_token;
    refreshToken = data.refresh_token;
    tokenExpiry  = Date.now() + (data.expires_in - 60) * 1000;
    res.send(
      '<html><body style="font-family:sans-serif;padding:40px;max-width:600px">' +
      '<h2 style="color:green">Google Drive connected!</h2>' +
      '<p>Save this as <strong>GOOGLE_REFRESH_TOKEN</strong> in Render:</p>' +
      '<p style="background:#f5f5f5;padding:12px;border-radius:6px;font-size:13px;word-break:break-all"><code>' + data.refresh_token + '</code></p>' +
      '<p>This token does <strong>not expire</strong>. You can close this tab.</p></body></html>'
    );
  } catch (err) {
    res.status(500).send('Auth failed: ' + err.message);
  }
});

// Self-refresh - called by app Refresh button
app.post('/refresh-token', async (req, res) => {
  try {
    await getAccessToken();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message });
  }
});

// List files in a Google Drive folder
app.get('/drive/files', async (req, res) => {
  try {
    const token    = await getAccessToken();
    const folderId = req.query.folderId;
    if (!folderId) return res.status(400).json({ error: 'Missing folderId' });
    const params = new URLSearchParams({
      q:        '"' + folderId + '" in parents and trashed = false',
      fields:   'files(id,name,mimeType,modifiedTime,size)',
      pageSize: '1000'
    });
    const r = await fetch('https://www.googleapis.com/drive/v3/files?' + params, {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error && data.error.message ? data.error.message : JSON.stringify(data));
    res.json(data);
  } catch (err) {
    console.error('[drive/files]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Download a file
app.get('/drive/download', async (req, res) => {
  try {
    const token  = await getAccessToken();
    const fileId = req.query.fileId;
    if (!fileId) return res.status(400).json({ error: 'Missing fileId' });
    console.log('[drive/download]', fileId);
    const r = await fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error('Drive API ' + r.status + ': ' + text.slice(0, 300));
    }
    const ct = r.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    const buf = await r.arrayBuffer();
    res.end(Buffer.from(buf));
  } catch (err) {
    console.error('[drive/download]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback — serve index.html for any unmatched route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log('Survey Access proxy running on port ' + PORT));
