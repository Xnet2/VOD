// בונה את הגרסה של Cloudflare (cloudflare/site) מקבצי האתר שבתיקייה הראשית:
// אותו אתר בדיוק, רק בלי האייקון (favicon), בלי תגובות ובלי דף הניהול.
// שימוש:  node cloudflare/build.mjs   ואז   cd cloudflare && npx wrangler@4 deploy
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'site');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ['auth.js', 'logo.png']) cpSync(join(root, f), join(out, f));

const html = readFileSync(join(root, 'index.html'), 'utf8')
  .split('\n')
  .filter(line => !/rel="(icon|apple-touch-icon)"/.test(line))   // בלי האייקון
  .filter(line => !/accounts\.google\.com\/gsi\/client/.test(line)) // בלי התחברות Google (אין תגובות)
  .join('\n');
writeFileSync(join(out, 'index.html'), html);

const config = readFileSync(join(root, 'config.js'), 'utf8')
  .replace(/window\.VOD_CONFIG = \{/, 'window.VOD_CONFIG = {\n  COMMENTS: false, // גרסת Cloudflare: בלי תגובות');
if (!config.includes('COMMENTS: false')) throw new Error('could not set COMMENTS: false in config.js');
writeFileSync(join(out, 'config.js'), config);

console.log('built', out);
