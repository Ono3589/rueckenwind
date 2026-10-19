// Erzeugt die drei Geheimnisse und legt sie direkt bei Cloudflare ab, ohne dass du etwas kopieren musst:
//   VAPID_PUBLIC, VAPID_PRIVATE_JWK  (Schlüsselpaar, mit dem sich dein Dienst gegenüber Apple ausweist)
//   API_TOKEN                        (Passwort, das du gleich in der App einträgst)
//   INGEST_TOKEN                     (Passwort im Kurzbefehl, das nur Fahrten abliefern darf)
// Der private Schlüssel wird nie angezeigt oder gespeichert. Nur das Token wird einmal ausgegeben.
// Aufruf (von überall):  node worker/scripts/setup-secrets.mjs
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { b64u } from '../src/webpush.js';

// Immer im Ordner worker/ arbeiten, egal von wo das Skript gestartet wird (dort liegt wrangler.toml)
const WORKER_DIR = fileURLToPath(new URL('..', import.meta.url));
const WRANGLER = (process.env.WRANGLER_CMD ?? 'npx wrangler@4').split(' ');

function putSecret(name, value) {
  const [cmd, ...args] = WRANGLER;
  const r = spawnSync(cmd, [...args, 'secret', 'put', name], { input: value, encoding: 'utf8', cwd: WORKER_DIR, stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) {
    console.error(`\nFehler bei ${name}. Es wurde nichts weiter geändert. Starte das Skript einfach noch einmal.`);
    process.exit(1);
  }
}

// Aufruf mit „ingest“ erzeugt nur den Abliefer-Schlüssel für den Kurzbefehl. Alles andere bleibt unberührt.
if (process.argv[2] === 'ingest') {
  const ingest = randomBytes(24).toString('hex');
  putSecret('INGEST_TOKEN', ingest);
  console.log('\n✅ Fertig. Abliefer-Token für den Kurzbefehl (nur jetzt sichtbar, bitte kopieren):\n');
  console.log(`   ${ingest}\n`);
  console.log('Er darf nur Fahrten abliefern, nichts lesen und keine Einstellungen ändern.\n');
  process.exit(0);
}

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = b64u.encode(await crypto.subtle.exportKey('raw', pair.publicKey));
const privateJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
const token = randomBytes(24).toString('hex');
const ingest = randomBytes(24).toString('hex');

putSecret('VAPID_PUBLIC', publicKey);
putSecret('VAPID_PRIVATE_JWK', privateJwk);
putSecret('API_TOKEN', token);
putSecret('INGEST_TOKEN', ingest);

console.log('\n✅ Fertig. Dein Token für die App (nur jetzt sichtbar, bitte kopieren und sicher aufbewahren):\n');
console.log(`   ${token}\n`);
console.log('Abliefer-Token für den Kurzbefehl (darf nur Fahrten abliefern):\n');
console.log(`   ${ingest}\n`);
