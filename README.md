# nodejs-advanced-features-4

HTTP and application logging with **morgan** and **winston**, plus a real
deployment plan. A small Express 5 products API that generates real log
traffic so every logging feature can be observed end-to-end.

## Why both morgan AND winston?

They answer different questions:

- **morgan** logs the HTTP layer — *what happened at the network boundary*.
  For every request it records method, path, status, response size, referrer,
  user agent and response time in the standard Apache **combined** format.
- **winston** logs *everything else* — business logic, validation failures,
  data lookups, security events, and crashes. It writes structured JSON with
  timestamps and stack traces, supports levels (`debug`...`error`) and rotates
  its files automatically.

morgan produces an **access log**, winston produces **application logs**. Used
together, one request produces entries in both files, and the `X-Request-Id`
header ties them together (see below).

## Log file layout

All files live in `logs/` (the directory is created automatically on startup).
Rotation uses winston's built-in `maxsize`/`maxFiles` on the File transports —
no extra packages needed.

| File             | Written by         | Level   | Format                              | Rotation                              |
| ---------------- | ------------------ | ------- | ----------------------------------- | ------------------------------------- |
| `logs/access.log`| morgan             | n/a     | `combined` (+ trailing request id); `short` in development | stream is append-only; rotate via logrotate on a VPS |
| `logs/app.log`   | winston             | `info`+ | JSON lines with `timestamp`/`level`/`message` | 5 MB × 5 files, `tailable`           |
| `logs/error.log` | winston             | `error` | JSON lines with `timestamp`/`level`/`message`/`stack` | 5 MB × 5 files, `tailable`           |
| `logs/pm2-out.log`, `logs/pm2-error.log` | PM2 (VPS deploy) | n/a | PM2 stdout/stderr | via `logrotate` (see DEPLOYMENT.md) |

In production the console output is plain; in development winston colourises it
and morgan prints the `dev` format to the terminal.

## LOG_LEVEL

Set `LOG_LEVEL` in `.env` (or as an env var at deploy time). Levels, from most
to least severe: `error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly`.
A level acts as a floor: `info` writes `info`, `warn` and `error`; `debug`
does **not** appear. `error` entries are duplicated to `error.log` — this is
what makes the demo endpoint (which writes `debug`/`info`/`warn`/`error`)
demonstrate both filtering and the dedicated error file.

## Tracing one request across both logs with X-Request-Id

1. The `X-Request-Id` request middleware assigns `req.id`
   (`x-request-id` header value, or a fresh UUID) and echoes it back in the
   `X-Request-Id` **response** header.
2. In production (`NODE_ENV=production`) morgan's `combined-trace` format
   appends that id to the end of each access.log line, so you can find the
   HTTP entry. In development morgan uses the built-in `short` format, which
   does not include the id — set `NODE_ENV=production` to trace from
   `access.log` too. The `app.log` side works in both modes.
3. winston entries for products include the same `requestId` in their JSON
   metadata.

To trace a request, pick a value, send it in — then grep both logs:

```
curl -i -H "X-Request-Id: trace-123" http://localhost:3013/api/products/1
grep "trace-123" logs/access.log
grep "trace-123" logs/app.log
```

## Environment variables

| Variable  | Default     | Purpose                                                        |
| --------- | ----------- | -------------------------------------------------------------- |
| `PORT`    | `3013`      | HTTP port. Render/Heroku inject their own value — never hardcode it in production. |
| `NODE_ENV`| `development` | `production` switches morgan to `combined-trace` and disables console colouring. |
| `LOG_LEVEL` | `info`    | Minimum winston level written (see above).                     |
| `LOG_DIR` | `logs`      | Directory for log files, resolved from the project root; created automatically. |

Copy `.env.example` to `.env` for local development. On Render these are set by
`render.yaml`; on Heroku use `heroku config:set`.

## API endpoints

| Method | Route               | Description                                    |
| ------ | ------------------- | ---------------------------------------------- |
| GET    | `/`                 | API index: service info and endpoint list      |
| GET    | `/health`           | Liveness probe, returns `{ status: 'ok' }`     |
| GET    | `/api/products`     | List the 6 in-memory products                  |
| GET    | `/api/products/:id` | Fetch one product by id (404 if missing)       |
| POST   | `/api/products`     | Create a product (`name` string, `price` number ≥ 0); 400 on invalid input |
| GET    | `/api/logs/demo`    | Writes one entry at `debug`, `info`, `warn`, `error` |
| GET    | `/api/logs/summary` | Returns the last 20 lines of `app.log`, `access.log` and `error.log` |
| ANY    | anything else       | JSON 404                                   |

## npm scripts

| Script         | Command              | Use                                       |
| -------------- | -------------------- | ----------------------------------------- |
| `start`        | `node server.js`     | Run the server (production-style)         |
| `dev`          | `nodemon server.js`  | Run with auto-restart on file changes     |
| `start:prod`   | `node server.js`     | Explicit production entry point           |

## Project layout

```
server.js                 entry point: requestId -> morgan -> routes -> 404 -> error handler
middleware/logger.js      winston logger (console + app.log + error.log)
middleware/requestLogger.js  morgan factory (dev/combined + access.log stream)
middleware/notFound.js    JSON 404
middleware/errorHandler.js   JSON 500 via winston
routes/productRoutes.js   demo products API + log demo/summary routes
utils/paths.js            resolves logs/ regardless of cwd and creates it
utils/requestId.js        X-Request-Id middleware
ecosystem.config.cjs      PM2 cluster config for the VPS
render.yaml               Render blueprint
Procfile                  Heroku web process
DEPLOYMENT.md             full deployment plan (Heroku / Vercel / Render / VPS)
```

## Running locally

```
npm install
npm run dev
curl http://localhost:3013/health
curl http://localhost:3013/api/logs/demo
curl http://localhost:3013/api/logs/summary
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the four-platform deployment plan.

## Deploying to Render

The repo ships with a [render.yaml](./render.yaml) blueprint, so deployment is
zero-config:

1. Push this repository to GitHub.
2. In the Render dashboard choose **New → Blueprint**, select the repo and
   confirm — Render reads `render.yaml` and creates the web service
   (`runtime: node`, free plan) with build command `npm install --production`,
   start command `node server.js`, health check `/health`, and the
   `NODE_ENV` / `LOG_LEVEL` / `LOG_DIR` env vars.
3. Render injects `PORT` itself; the app listens on `0.0.0.0` and follows it.
4. Pushes to the default branch auto-deploy.

Manual alternative: **New → Web Service**, Build Command
`npm install --production`, Start Command `node server.js`, Health Check Path
`/health`. See the Render section of [DEPLOYMENT.md](./DEPLOYMENT.md) for
details on ephemeral disks and log persistence.