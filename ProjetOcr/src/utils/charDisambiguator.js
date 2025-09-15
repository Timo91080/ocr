// Utilitaire de désambiguïsation caractères OCR manuscrits / bruités
// Objectif: corriger les confusions fréquentes lettre<->chiffre de façon contextuelle.
// Activation contrôlée par AMBIGUOUS_CORRECTION=1

const DEFAULT_RULES = [
  // pattern, replacement, condition(description)
  { pattern: /O/g, replacement: '0', ctx: 'tokenHas2Digits' },
  { pattern: /D/g, replacement: '0', ctx: 'tokenHas2Digits' },
  { pattern: /I/g, replacement: '1', ctx: 'tokenHas2Digits' },
  { pattern: /L/g, replacement: '1', ctx: 'tokenHas2Digits' },
  { pattern: /Z/g, replacement: '2', ctx: 'tokenHas2Digits' },
  { pattern: /S/g, replacement: '5', ctx: 'tokenHas2Digits' },
  { pattern: /B/g, replacement: '8', ctx: 'tokenHas2Digits' },
  { pattern: /G/g, replacement: '6', ctx: 'tokenHas2Digits' },
  { pattern: /Q/g, replacement: '0', ctx: 'tokenHas2Digits' },
  // Inverse dans contexte majoritairement lettres (éviter faux positifs)
  { pattern: /(?<=^|\b)0(?=[A-Z]{3,})/g, replacement: 'O', ctx: 'mostlyLetters' },
  { pattern: /(?<=^|\b)1(?=[A-Z]{3,})/g, replacement: 'I', ctx: 'mostlyLetters' }
];

// Règles spécialisées code privilège (4 chars): corriger doublons improbables & confusions 6/8/G
const CODE_PRIV_RULES = [
  { pattern: /^4GG([A-Z0-9])$/, replacement: '4G8$1' },
  { pattern: /^4G6([A-Z0-9])$/, replacement: '4G8$1' },
  { pattern: /^4G0([A-Z0-9])$/, replacement: '4G8$1' }
];

function analyzeToken(token){
  const digits = (token.match(/\d/g)||[]).length;
  const letters = (token.match(/[A-Z]/gi)||[]).length;
  return {
    digits, letters,
    tokenHas2Digits: digits >= 2,
    mostlyLetters: letters >= 3 && digits === 0,
  };
}

export function disambiguateToken(raw, customRules=[]) {
  let token = raw;
  if (!token || token.length < 2) return token;
  const upper = token.toUpperCase();
  const info = analyzeToken(upper);
  const rules = [...DEFAULT_RULES, ...customRules];
  let applied = [];
  for (const r of rules) {
    if (!r.pattern) continue;
    if (r.ctx && !info[r.ctx]) continue;
    if (r.pattern.test(upper)) {
      const before = token;
      token = token.replace(r.pattern, r.replacement);
      applied.push({ rule: r.pattern.toString(), replacement: r.replacement, before, after: token });
    }
  }
  return { token, applied };
}

export function disambiguateStructuredFields(fields, opts = {}) {
  const enabled = process.env.AMBIGUOUS_CORRECTION === '1';
  if (!enabled) return { corrected: fields, changes: [] };
  const changes = [];
  const applyOn = (value, path) => {
    if (value == null) return value;
    const str = String(value);
    const { token, applied } = disambiguateToken(str);
    if (applied.length && token !== str) {
      changes.push({ path, before: str, after: token, rules: applied });
      return token;
    }
    return value;
  };
  // Corriger client
  if (fields.client) {
    ['numero_client','code_privilege'].forEach(k => {
      if (fields.client[k]) fields.client[k] = applyOn(fields.client[k], 'client.'+k);
    });
    // Application spécifique code privilège
    if (fields.client.code_privilege && fields.client.code_privilege.length===4) {
      let cp = fields.client.code_privilege.toUpperCase();
      for (const r of CODE_PRIV_RULES) {
        if (r.pattern.test(cp)) cp = cp.replace(r.pattern, r.replacement);
      }
      fields.client.code_privilege = cp;
    }
  }
  // Corriger articles
  if (Array.isArray(fields.articles)) {
    fields.articles.forEach((a, idx) => {
      ['reference','taille_ou_code'].forEach(k => {
        if (a && a[k]) a[k] = applyOn(a[k], `articles[${idx}].${k}`);
      });
    });
  }
  // Corriger totaux (les montants déjà numérisés ne doivent pas être transformés au hasard)
  // On n'applique que si c'est encore une chaîne.
  if (fields.totaux) {
    ['sous_total_articles','total_commande','total_avec_frais'].forEach(k => {
      if (typeof fields.totaux[k] === 'string') {
        fields.totaux[k] = applyOn(fields.totaux[k], 'totaux.'+k);
      }
    });
  }
  return { corrected: fields, changes };
}

export default { disambiguateStructuredFields };
