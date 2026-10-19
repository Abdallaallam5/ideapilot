const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VERSIONED_DIRS = ['css', 'js', 'images', 'videos'];

/**
 * A short hash of the public assets, appended to their URLs so browsers fetch
 * new files after a deploy instead of reusing a cached old copy.
 */
function computeAssetVersion() {
  const hash = crypto.createHash('sha1');
  for (const dir of VERSIONED_DIRS) {
    const full = path.join(PUBLIC_DIR, dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full).sort()) {
      const file = path.join(full, name);
      if (fs.statSync(file).isFile()) hash.update(name).update(fs.readFileSync(file));
    }
  }
  return hash.digest('hex').slice(0, 10);
}

const version = computeAssetVersion();

/** Returns the URL with a cache-busting version, e.g. /static/css/main.css?v=ab12cd34ef. */
function asset(url) {
  return `${url}${url.includes('?') ? '&' : '?'}v=${version}`;
}

module.exports = { asset, version };
