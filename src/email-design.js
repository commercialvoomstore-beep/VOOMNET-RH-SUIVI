/* Gabarit d'e-mail commun au navigateur et au relais : aucun HTML utilisateur n'est accepté. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VoomnetMailDesign = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const titles = { contract: 'Suivi de votre contrat', prime: 'Votre prime trimestrielle', summary: 'Récapitulatif RH' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const logoSources = { hosted: 'https://rh-suivi.netlify.app/voomnet-logo.png', inline: 'cid:voomnet-logo', preview: '/voomnet-logo.png' };
  function renderEmailHtml(text, kind = 'contract', logoMode = 'hosted') {
    const logo = logoSources[logoMode] || logoSources.hosted;
    const title = titles[kind] || titles.contract;
    const paragraphs = String(text ?? '').replace(/\r\n?/g, '\n').split(/\n{2,}/).map(p => `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#35415a;overflow-wrap:anywhere;">${escape(p).replace(/\n/g, '<br>')}</p>`).join('');
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;padding:0;background-color:#f2f4f9;font-family:Arial,Helvetica,sans-serif;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f2f4f9;"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:600px;background-color:#ffffff;"><tr><td style="padding:20px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#11144b;letter-spacing:0.3px;"><img src="${logo}" width="198" height="69" alt="VOOMNET Technology" style="display:block;width:198px;max-width:100%;height:auto;border:0;color:#11144b;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;"></td></tr><tr><td style="padding:18px 28px;background-color:#100d4b;color:#ffffff;font-family:Arial,Helvetica,sans-serif;"><div style="font-size:17px;font-weight:bold;line-height:1.4;">${title}</div><div style="font-size:12px;line-height:1.5;color:#d5d8ed;">Votre espace Ressources humaines</div></td></tr><tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f6fa;border:1px solid #e1e5ef;border-radius:10px;"><tr><td style="padding:22px;">${paragraphs}</td></tr></table></td></tr><tr><td style="padding:0 28px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#667189;">VOOMNET Technology / Formation<br>Message d’information des Ressources humaines</td></tr></table></td></tr></table></body></html>`;
  }
  return { renderEmailHtml };
});
