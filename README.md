# Survey Access — Box Proxy

Tiny Express proxy that sits between the Survey Access PWA and the Box API.
Handles token refresh automatically — no manual token management needed.

## Deploy to Render

1. Push this folder to a GitHub repo
2. Create a new **Web Service** on Render pointing at that repo
3. Set environment variables (see below)
4. Deploy

## Environment Variables

| Variable | Value |
|---|---|
| `BOX_CLIENT_ID` | Your Box app Client ID |
| `BOX_CLIENT_SECRET` | Your Box app Client Secret |
| `BOX_REFRESH_TOKEN` | Initial refresh token (get via /auth/callback first time) |
| `ALLOWED_ORIGIN` | `https://sites.pplx.app` |

## One-time Auth Setup

After deploying, visit this URL in your browser to get the initial refresh token:

```
https://account.box.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=https://app.box.com&response_type=code
```

Box will redirect to `https://app.box.com?code=XXXX`. Copy the `code` value from the URL and visit:

```
https://YOUR-RENDER-URL.onrender.com/auth/callback?code=XXXX
```

The page will show your refresh token — copy it into the `BOX_REFRESH_TOKEN` environment variable in Render.
