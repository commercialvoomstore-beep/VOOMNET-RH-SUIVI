import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { renderEmailHtml } = require('../src/email-design.js');

test('gabarits de primes, contrats et récapitulatifs conservent le texte et le logo', () => {
  for (const [kind, title] of [['prime', 'Votre prime trimestrielle'], ['contract', 'Suivi de votre contrat'], ['summary', 'Récapitulatif RH']]) {
    const html = renderEmailHtml('Bonjour Zoé,\n\nPremière ligne\nDeuxième ligne.', kind);
    assert.ok(html.includes(title)); assert.ok(html.includes('VOOMNET Technology')); assert.ok(html.includes('Bonjour Zoé,')); assert.ok(html.includes('Première ligne<br>Deuxième ligne.'));
    assert.ok(html.includes('role="presentation"')); assert.ok(html.includes('src="https://rh-suivi.netlify.app/voomnet-logo.png"')); assert.ok(html.includes('alt="VOOMNET Technology"'));
    assert.ok(renderEmailHtml('test', kind, 'inline').includes('src="cid:voomnet-logo"'));
    assert.ok(renderEmailHtml('test', kind, 'preview').includes('src="/voomnet-logo.png"'));
  }
});
test('logo inline identique au fichier fourni et publié', () => {
  assert.deepEqual(Buffer.from(require('../src/email-logo.cjs'), 'base64'), readFileSync(new URL('../assets/voomnet-logo.png', import.meta.url)));
});
test('tout texte utilisateur est échappé, y compris les balises et attributs malveillants', () => {
  const html = renderEmailHtml('<script>alert("x")</script>\n<img src=x onerror=alert(1)> & bonjour', 'prime');
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')); assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; bonjour'));
  assert.ok(!/<script\b/i.test(html)); assert.equal((html.match(/<img\b/gi) || []).length, 1);
});
