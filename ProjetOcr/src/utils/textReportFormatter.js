// Génère un rapport texte lisible similaire à l'ancien format partagé par l'utilisateur
// Objectif: offrir une vue humaine synthétique avant export

function formatMoney(v){
  if(v==null || v==='') return '';
  const n = Number(v);
  if(isNaN(n)) return '';
  return n.toFixed(2).replace(/\.00$/,'');
}

function sanitizeColoris(c){
  if(!c) return null;
  const low = c.toLowerCase().replace(/\s+/g,'');
  // placeholders issus d'OCR: code10, codelo, cod10, code1o
  if(/^code?1?0$/.test(low) || /^code?lo$/.test(low) || /^code?io$/.test(low)) return null;
  return c;
}

export function generateTextReport(extraction){
  if(!extraction) return '';
  const { client = {}, articles = [], totaux = {} } = extraction;
  const lines = [];
  lines.push('👤 INFORMATIONS PERSONNELLES:');
  lines.push('--------------------------------------------------');
  if(client.nom_complet) lines.push(`- Nom: ${client.nom_complet}`);
  if(client.numero_client) lines.push(`- Numéro client: ${client.numero_client}`);
  if(client.code_privilege) lines.push(`- Code privilège: ${client.code_privilege}`);
  if(client.telephone_portable) lines.push(`- Téléphone portable: ${client.telephone_portable}`);
  if(client.telephone_fixe) lines.push(`- Téléphone fixe: ${client.telephone_fixe}`);
  if(client.date_naissance) lines.push(`- Date de naissance: ${client.date_naissance}`);
  if(client.email) lines.push(`- Email: ${client.email}`);
  lines.push('');

  // Totaux IA
  const totalArticles = articles.reduce((a,c)=> a + (c.total_ligne || c.prix_unitaire || 0),0);
  const totalFmt = formatMoney(totalArticles);
  lines.push(`🤖 EXTRACTION IA:`);
  lines.push(`- Articles: ${articles.length}`);
  if(totalFmt) lines.push(`- Total articles: ${totalFmt}`);
  if(totaux.total_commande!=null) lines.push(`- Total commande annoncé: ${formatMoney(totaux.total_commande)}`);
  if(totaux.total_avec_frais!=null) lines.push(`- Total avec frais: ${formatMoney(totaux.total_avec_frais)}`);
  lines.push('');

  lines.push('📦 ARTICLES COMMANDÉS:');
  lines.push('--------------------------------------------------');
  if(!articles.length){
    lines.push('(Aucun article détecté)');
  }
  articles.forEach((a,i)=>{
    const coloris = sanitizeColoris(a.coloris);
    lines.push('');
    lines.push(`### ARTICLE ${i+1}:`);
    if(a.page_catalogue) lines.push(`- Page: ${a.page_catalogue}`);
    if(a.nom_produit) lines.push(`- Nom: ${a.nom_produit}`);
    if(coloris) lines.push(`- Coloris: ${coloris}`);
    if(a.reference) lines.push(`- Référence: ${a.reference}`);
    if(a.taille_ou_code) lines.push(`- Taille/Code: ${a.taille_ou_code}`);
    if(a.quantite!=null) lines.push(`- Quantité: ${a.quantite}`);
    if(a.prix_unitaire!=null) lines.push(`- Prix unitaire: ${formatMoney(a.prix_unitaire)}`);
    if(a.total_ligne!=null) lines.push(`- Total: ${formatMoney(a.total_ligne)}`);
  });

  // Anomalies / suggestions
  const anomalies = [];
  if(totaux.total_commande!=null && totalArticles && Math.abs(totaux.total_commande - totalArticles) > 0.05){
    anomalies.push(`Écart entre somme des lignes (${totalFmt}) et total_commande (${formatMoney(totaux.total_commande)}).`);
  }
  const placeholderColors = articles.filter(a=>{const c=a.coloris; if(!c) return false; const low=c.toLowerCase().replace(/\s+/g,''); return /^code?1?0$/.test(low)||/^code?lo$/.test(low)||/^code?io$/.test(low);});
  if(placeholderColors.length){
    anomalies.push(`${placeholderColors.length} coloris placeholder ignoré(s).`);
  }
  if(!articles.length) anomalies.push('Aucun article: vérifier la qualité OCR ou cadrage.');
  if(anomalies.length){
    lines.push('\n⚠️ ANOMALIES / SUGGESTIONS:');
    anomalies.forEach(a=>lines.push('- '+a));
  }

  return lines.join('\n');
}

export default { generateTextReport };
