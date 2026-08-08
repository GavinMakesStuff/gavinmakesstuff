'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function makeTmpDir(prefix = 'mo-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

module.exports = { makeTmpDir, writeFile };
