// Erzeugt das Schlüsselpaar, mit dem sich dein Push-Dienst gegenüber Apple ausweist.
// Aufruf: node worker/scripts/gen-vapid.mjs
import { b64u } from '../src/webpush.js';

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicRaw = b64u.encode(await crypto.subtle.exportKey('raw', pair.publicKey));
const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

console.log('\nÖFFENTLICHER Schlüssel (darf bekannt sein), als VAPID_PUBLIC eintragen:\n');
console.log(publicRaw);
console.log('\nPRIVATER Schlüssel. GEHEIM, nie committen oder weitergeben. Als VAPID_PRIVATE_JWK hinterlegen:\n');
console.log(JSON.stringify(privateJwk));
console.log('\nBeides jetzt kopieren. Der private Schlüssel wird nirgends gespeichert.\n');
