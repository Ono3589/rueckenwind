// Schreibt den Startbildschirm fest in index.html, damit er schon vor dem JavaScript sichtbar ist.
// Aufruf nach Änderungen an js/scene.js: node scripts/inject-splash.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { commuteScene } from '../js/scene.js';

const file = new URL('../index.html', import.meta.url);
const html = readFileSync(file, 'utf8');
const word = [...'Rückenwind'].map((c, i) => `<span style="--i:${i}">${c}</span>`).join('');
const splash = `<!-- splash:start -->
  <div id="splash" class="splash" aria-hidden="true">
    ${commuteScene({ status: 'go', score: 90, windKmh: 14, headKmh: -6, uid: 'splash', variant: 'splash', label: 'Rückenwind' })}
    <div class="splash-mark">
      <p class="wordmark">${word}</p>
      <p class="splash-tag">Jeden Morgen die Antwort.</p>
    </div>
  </div>
  <!-- splash:end -->`;
const out = html.replace(/<!-- splash:start -->[\s\S]*?<!-- splash:end -->/, splash);
if (out === html && !html.includes(splash)) throw new Error('Markierung splash:start fehlt in index.html');
writeFileSync(file, out);
console.log('Startbildschirm geschrieben');
