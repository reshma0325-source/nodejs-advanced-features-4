# Deployment Overview

This project is a long-running Express 5 HTTP server that uses morgan for HTTP
access logs and winston for application logs. Every platform in the table below
can run it, but they differ in how much work you have to do yourself. The PORT
variable is the key requirement everywhere: the app reads `process.env.PORT`
and falls back to `3013`, and the server listens on `0.0.0.0` so it accepts
traffic on every network interface. Cloud platforms inject their own `PORT`
value and you generally should NOT hardcode yours.

## Platform Overview

| Platform | Config Needs                                      | Notes                                          |
| -------- | -------------------------------------------------- | ---------------------------------------------- |
| 🟪 Heroku | Procfile, PORT, dotenv                             | Great for quick deploy                         |
| 🟦 Vercel | Only frontend supported                            | Use APIs via Vercel Functions                  |
| ☁️ Render | Easy for Node.js apps                              | Supports DB connections                        |
| 🔐 VPS    | Manual setup + Nginx                               | Max flexibility                                |

## The PORT requirement

This app binds to `0.0.0.0` and reads `process.env.PORT` (default `3013` on
your machine). Heroku, Render and most PaaS providers set `PORT` for you, so
just leave it alone in production. Locally, `.env` with `PORT=3013` is used.
Never hardcode `3013` in a deployed environment or your platform health check
will not be reachable.

## Why Vercel cannot host a long-running Express server

Vercel is built around serverless functions that are short-lived, scale to
zero, and have no persistent filesystem or listening socket. A blocking
`app.listen()` Express process does not fit that model:

- There is no long-running Node process you can keep alive.
- Logs written to disk (`logs/app.log`) would be ephemeral and per-function.
- Streaming, WebSockets and open connections are not supported.

What to do instead:

1. Deploy this API to Render or Heroku and serve the frontend SPA from Vercel.
2. Or expose a single Express request handler as a Vercel Function (serverless
   rewrite), e.g. `api/index.js` exporting the Express `app`. Each request is
   handled by the same router, but there is no persistent process. In that case
   stream logs to a remote logging service instead of local files.

## Heroku

1. `heroku login`
2. `heroku create nodejs-advanced-features-4`
3. The `Procfile` (`web: node server.js`) is picked up automatically — no dyno
   config needed. Heroku runs the command from the Procfile directly (it is
   equivalent to `npm start`).
4. Set config variables (do not commit `.env`):
   ```
   heroku config:set NODE_ENV=production
   heroku config:set LOG_LEVEL=info
   heroku config:set LOG_DIR=logs
   ```
   Heroku provides `PORT` automatically; there is nothing to set.
5. Deploy:
   ```
   git push heroku main
   ```
6. Open the app and tail logs:
   ```
   heroku open
   heroku logs --tail
   ```
   Heroku's ephemeral filesystem means `logs/*.log` are lost on restart. For
   durable output, forward winston to a log drain (e.g. `heroku drains:add`)
   or a service like Logtail/Papertrail.

## Render

1. Push the repo to GitHub/GitLab and choose **New → Blueprint** (reads this
   repo's `render.yaml`), or create a **Web Service** manually and point
   `Build Command` to `npm install --production` and `Start Command` to
   `node server.js`.
2. With the blueprint (`render.yaml`) the service is `runtime: node`, plan
   `free`, `healthCheckPath: /health` and env vars are set automatically:
   - `NODE_ENV=production`
   - `LOG_LEVEL=info`
   - `LOG_DIR=logs`
   Render injects `PORT` itself — do not hardcode `3013`.
3. `Health Checks` → path `/health`; renders fine because `/health` returns
   `200`.
4. Important: Render's container filesystem is **ephemeral**. Files written to
   `logs/` disappear on deploy or when the service is scaled/restarted. Use an
   attached disk (Render Disk) by setting `LOG_DIR=/var/data/logs` and mounting
   a persistent disk there, or export logs to an external service.
5. Provision from the blueprint: in the dashboard choose **New → Blueprint**,
   connect the repo and **Deploy Blueprint** (Render reads `render.yaml`).
   To check the file before pushing, install the Render CLI and run
   `render blueprints validate`.

## VPS (Virtual Private Server)

Full control. You are responsible for the process manager, reverse proxy and TLS.

1. Install Node.js 18+ and Nginx on the VPS:
   ```
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs nginx
   ```
2. Deploy the code, install production dependencies:
   ```
   git clone <repo-url> /opt/nodejs-advanced-features-4
   cd /opt/nodejs-advanced-features-4
   npm install --production
   export NODE_ENV=production
   export PORT=3013
   export LOG_DIR=logs
   ```
3. Run under PM2 in cluster mode using the checked-in config:
   ```
   npm i -g pm2
   pm2 start ecosystem.config.cjs
   pm2 save
   pm2 startup
   ```
   `ecosystem.config.cjs` defines `instances: 'max'`, `exec_mode: 'cluster'`,
   out/error files under `logs/`, and restarts the process above 300 MB.
4. Nginx reverse proxy (`/etc/nginx/sites-available/lms`):
   ```
   server {
     listen 80;
     server_name api.example.com;

     location / {
       proxy_pass http://127.0.0.1:3013;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```
   ```
   sudo ln -s /etc/nginx/sites-available/lms /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```
5. TLS with Certbot / Let's Encrypt:
   ```
   sudo apt-get install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d api.example.com
   ```
6. Rotate the on-disk logs so they don't fill the disk. Create
   `/etc/logrotate.d/lms`:
   ```
   /opt/nodejs-advanced-features-4/logs/*.log {
     daily
     rotate 14
     compress
     missingok
     notifempty
     copytruncate
   }
   ```
   `copytruncate` is used because winston/morgan hold the file handles open.

## Pre-deploy checklist

- [ ] `NODE_ENV=production` is set — this switches morgan from `dev` to
      `combined` and disables winston's console colouring.
- [ ] Never commit `.env` — it is in `.gitignore`. Supply variables through the
      platform's config UI or CLI instead.
- [ ] Log rotation is configured: built-in winston `maxsize`/`maxFiles`
      (5 MB × 5 files) locally, and `logrotate` on a VPS.
- [ ] The `/health` endpoint exists and returns `200` — point the platform's
      health check at it.
- [ ] No secrets (tokens, passwords, DB credentials) ever reach log output.
- [ ] `LOG_DIR=logs` points at a writable location; on ephemeral platforms use
      an external log service or a persistent disk.