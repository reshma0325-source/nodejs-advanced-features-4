# Solution — Case Study 4: Logging with Morgan and Winston + Deployment Plan

## Objective

Log API activity using **morgan** for the HTTP layer and **winston** for custom
(application) logs, and provide a deployment plan for the four platforms.

Both loggers run side by side on the same Express 5 app:

- **morgan** writes `logs/access.log` — one line per HTTP request (method, path,
  status, size, referrer, user agent, response time).
- **winston** writes `logs/app.log` (info and above) and `logs/error.log`
  (errors only) — structured JSON with timestamps and stack traces.
- An `X-Request-Id` header ties one request's entries in both files together.

## Packages

```
npm install morgan winston
```

Also used: `express`, `dotenv` (for `PORT`/`NODE_ENV`/`LOG_LEVEL` config) and
`nodemon` as a dev dependency.

## 1. Winston logging setup — `middleware/logger.js`

The starter logger from the case study only writes `logs/app.log`. The complete
solution adds a level, JSON formatting, a console transport and a dedicated
error file:

```js
const winston = require('winston');
const { logsDir } = require('../utils/paths');

const level = process.env.LOG_LEVEL || 'info';

const consoleFormat =
  process.env.NODE_ENV === 'production'
    ? winston.format.simple()
    : winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.simple()
      );

const logger = winston.createLogger({
  level,
  exitOnError: false,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.File({
      dirname: logsDir,
      filename: 'app.log',
      level: 'info',
      maxsize: 5 * 1024 * 1024, // 5 MB
      maxFiles: 5,
      tailable: true,
    }),
    new winston.transports.File({
      dirname: logsDir,
      filename: 'error.log',
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
  ],
});

module.exports = logger;
```

Key points:

- **Levels**: `error` > `warn` > `info` > `http` > `verbose` > `debug` > `silly`.
  `LOG_LEVEL` acts as a floor — with `info`, `debug` entries are filtered out.
- **Rotation** is built into the File transports (`maxsize` × `maxFiles`,
  `tailable`), so no extra package or logrotate config is needed for the
  application logs.
- `error` entries are duplicated to `error.log`, which makes `error.log` a
  clean "things that broke" feed.

The log directory itself is created on startup by `utils/paths.js`:

```js
const logsDir = path.resolve(projectRoot, process.env.LOG_DIR || 'logs');
fs.mkdirSync(logsDir, { recursive: true });
```

## 2. Morgan integration — `middleware/requestLogger.js`

Exactly the pattern from the case study, wrapped in a factory so the stream is
created once per app start:

```js
const fs = require('fs');
const morgan = require('morgan');
const { accessLogFile } = require('../utils/paths');

const isProduction = process.env.NODE_ENV === 'production';

morgan.token('request-id', (req) => req.id || req.headers['x-request-id'] || '-');

morgan.format(
  'combined-trace',
  ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :request-id'
);

function requestLogger() {
  const accessStream = fs.createWriteStream(accessLogFile, { flags: 'a' });

  return function loggerMiddleware(req, res, next) {
    if (isProduction) {
      morgan('combined-trace', { stream: accessStream })(req, res, next);
      return;
    }
    morgan('dev')(req, res, next);                              // terminal
    morgan('short', { stream: accessStream })(req, res, next);  // access.log
  };
}

module.exports = requestLogger;
```

Key points:

- `flags: 'a'` makes the access log **append-only** — restarts never truncate it.
- Production writes the **combined** format (plus the trailing request id) to
  `logs/access.log`; development also prints the colourised `dev` format to the
  terminal for a nicer local experience.

## 3. Request ID — `utils/requestId.js`

```js
const crypto = require('crypto');

module.exports = function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
```

morgan appends `req.id` to every access.log line in production
(`combined-trace` format), and winston entries include `requestId` in their
JSON metadata — so one id links both logs.

## 4. Wiring in `server.js`

```js
app.use(requestId);        // 1. assign/echo X-Request-Id
app.use(requestLogger());  // 2. morgan → access.log
app.use(express.json());
app.use('/health', healthRoute);
app.use('/api', productRoutes); // winston logging lives here
app.use(notFound);         // 3. JSON 404
app.use(errorHandler);     // 4. winston-logged JSON 500
```

The server also handles `uncaughtException` / `unhandledRejection` through
winston (flushing file buffers before exit) and has `SIGINT`/`SIGTERM`
graceful-shutdown handlers.

## 5. Log file layout

| File               | Writer  | Level    | Format                          | Rotation                       |
| ------------------ | ------- | -------- | ------------------------------- | ------------------------------ |
| `logs/access.log`  | morgan  | n/a      | `combined-trace` / `short`      | append-only; logrotate on VPS  |
| `logs/app.log`     | winston | `info`+  | JSON lines (`timestamp`, `level`, `message`) | 5 MB × 5 files, tailable |
| `logs/error.log`   | winston | `error`  | JSON lines + `stack`            | 5 MB × 5 files, tailable       |
| `logs/pm2-out.log`, `logs/pm2-error.log` | PM2 | n/a | PM2 stdout/stderr        | logrotate (VPS)                |

## 6. Demonstration endpoints

| Method | Route               | Purpose                                        |
| ------ | ------------------- | ---------------------------------------------- |
| GET    | `/health`           | Liveness probe                                 |
| GET    | `/api/products`     | Lists 6 in-memory products (logs `info`)       |
| GET    | `/api/products/:id` | Fetches one product; 404 logs `warn`           |
| POST   | `/api/products`     | Creates a product; invalid input logs `warn`   |
| GET    | `/api/logs/demo`    | Writes one entry at each level: `debug`, `info`, `warn`, `error` |
| GET    | `/api/logs/summary` | Returns the last 20 lines of all three log files |

### Verify locally

```
npm install
npm run dev
curl http://localhost:3013/health
curl http://localhost:3013/api/logs/demo
curl http://localhost:3013/api/logs/summary
```

### Trace one request across both logs

```
curl -i -H "X-Request-Id: trace-123" http://localhost:3013/api/products/1
grep "trace-123" logs/access.log
grep "trace-123" logs/app.log
```

With `LOG_LEVEL=info`, `/api/logs/demo` shows filtering in action: the `debug`
line is dropped, `info`/`warn` land in `app.log`, and `error` lands in **both**
`app.log` and `error.log`.

## 7. Deployment overview

| Platform | Config Needs                | Notes                                |
| -------- | --------------------------- | ------------------------------------ |
| 🟪 Heroku | Procfile, PORT, dotenv     | Great for quick deploy               |
| 🟦 Vercel | Only frontend supported    | Use APIs via Vercel Functions        |
| ☁️ Render | Easy for Node.js apps      | Supports DB connections              |
| 🔐 VPS    | Manual setup + Nginx       | Max flexibility                      |

The universal requirement: the app reads `process.env.PORT` (default `3013`)
and listens on `0.0.0.0`. Never hardcode the port in production — every PaaS
injects its own `PORT`.

- **Heroku** — `Procfile` (`web: node server.js`) is picked up automatically.
  Set `NODE_ENV=production`, `LOG_LEVEL=info`, `LOG_DIR=logs` with
  `heroku config:set`; `PORT` is provided by the platform. Deploy with
  `git push heroku main`.
- **Vercel** — serverless only: no long-running `app.listen()` process, no
  persistent disk (log files would be ephemeral). Serve the frontend from
  Vercel and host this API on Render/Heroku, or export the Express app as a
  single Vercel Function (`api/index.js`) and stream logs to a remote service.
- **Render** — `render.yaml` blueprint is included: Node runtime, free plan,
  `buildCommand: npm install --production`, `startCommand: node server.js`,
  `healthCheckPath: /health`, and `NODE_ENV`/`LOG_LEVEL`/`LOG_DIR` env vars.
- **VPS** — full manual setup: Node + PM2 (`ecosystem.config.cjs`, cluster mode
  `instances: 'max'`), Nginx as reverse proxy and TLS terminator, logrotate for
  `logs/*.log` and the PM2 files, plus `max_memory_restart: 300M`.

Full step-by-step commands for all four platforms are in
[DEPLOYMENT.md](./DEPLOYMENT.md).

## Project structure

```
server.js                    entry point: requestId → morgan → routes → 404 → error handler
middleware/logger.js          winston logger (console + app.log + error.log)
middleware/requestLogger.js   morgan factory (dev/combined + access.log stream)
middleware/notFound.js        JSON 404
middleware/errorHandler.js    JSON 500 via winston
routes/productRoutes.js       products API + /api/logs/demo and /api/logs/summary
utils/paths.js                resolves logs/ regardless of cwd and creates it
utils/requestId.js            X-Request-Id middleware
ecosystem.config.cjs          PM2 cluster config (VPS)
render.yaml                   Render blueprint
Procfile                      Heroku web process
DEPLOYMENT.md                 detailed deployment steps for all four platforms
```
