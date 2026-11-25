import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { renderEmailHtml } = createRequire(import.meta.url)('../src/email-design.js');

test('gabarits de primes, contrats et récapitulatifs conservent le texte et la marque', () => {
  for (const [kind, title] of [['prime', 'Votre prime trimestrielle'], ['contract', 'Suivi de votre contrat'], ['summary', 'Récapitulatif RH']]) {
    const html = renderEmailHtml('Bonjour Zoé,\n\nPremière ligne\nDeuxième ligne.', kind);
    assert.ok(html.includes(title)); assert.ok(html.includes('VOOMNET')); assert.ok(html.includes('Bonjour Zoé,')); assert.ok(html.includes('Première ligne<br>Deuxième ligne.'));
    assert.ok(html.includes('role="presentation"')); assert.ok(!/<img\b/i.test(html)); assert.ok(!/https?:\/\//i.test(html));
  }
});
test('tout texte utilisateur est échappé, y compris les balises et attributs malveillants', () => {
  const html = renderEmailHtml('<script>alert("x")</script>\n<img src=x onerror=alert(1)> & bonjour', 'prime');
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')); assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; bonjour'));
  assert.ok(!/<script\b/i.test(html)); assert.ok(!/<img\b/i.test(html));
});
