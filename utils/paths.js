const path = require('path');
const fs = require('fs');
const os = require('os');

const projectRoot = path.join(__dirname, '..');
const configuredDir = path.resolve(projectRoot, process.env.LOG_DIR || 'logs');

function ensureWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return dir;
  } catch (err) {
    console.warn(`Cannot use log directory ${dir}: ${err.message}`);
    return null;
  }
}

const logsDir =
  ensureWritableDir(configuredDir) ||
  ensureWritableDir(path.join(projectRoot, 'logs')) ||
  ensureWritableDir(path.join(os.tmpdir(), 'nodejs-advanced-features-4-logs')) ||
  projectRoot;

module.exports = {
  logsDir,
  accessLogFile: path.join(logsDir, 'access.log'),
  appLogFile: path.join(logsDir, 'app.log'),
  errorLogFile: path.join(logsDir, 'error.log'),
};