import { google } from 'googleapis';

/**
 * Service d'envoi des extractions vers Google Sheets
 * Utilise un compte de service (JWT) et la Google Sheets API v4
 */
class GoogleSheetsService {
  constructor() {
    const globalEnable = process.env.ENABLE_GOOGLE_SHEETS === '1';
    this.enabled = globalEnable && !!(process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
    if (!this.enabled) {
      if (globalEnable) {
        console.warn('ℹ️ GoogleSheetsService: activé mais variables manquantes (pas d\'envoi).');
      } else {
        console.log('ℹ️ GoogleSheetsService désactivé (ENABLE_GOOGLE_SHEETS != 1).');
      }
      return;
    }
    try {
      let rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
      // Enlever guillemets éventuels autour de la clé dans le .env
      if (rawKey.startsWith('"') && rawKey.endsWith('"')) {
        rawKey = rawKey.slice(1, -1);
      }
      // Remplacer les séquences échappées \n par de vrais sauts de ligne
      const privateKey = rawKey.replace(/\\n/g, '\n');
      if (!privateKey.includes('BEGIN PRIVATE KEY')) {
        throw new Error('Clé privée invalide: en-tête manquant');
      }
      this.jwt = new google.auth.JWT(
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        null,
        privateKey,
        [
          // Portée Sheets
          'https://www.googleapis.com/auth/spreadsheets',
          // Portée Drive (optionnelle) pour rendre la feuille publique si demandé
          'https://www.googleapis.com/auth/drive'
        ]
      );
      this.sheetId = process.env.GOOGLE_SHEET_ID;
      this.sheets = google.sheets({ version: 'v4', auth: this.jwt });
      this.drive = google.drive({ version: 'v3', auth: this.jwt });
      this.autoPublic = process.env.SHEET_AUTO_PUBLIC === '1';
      this.publicRole = process.env.SHEET_PUBLIC_ROLE || 'reader'; // reader ou writer
      console.log('✅ GoogleSheetsService initialisé');
    } catch (e) {
      console.error('❌ Erreur init GoogleSheetsService:', e.message);
      if (process.env.OCR_DEBUG === '1') {
        console.error('Exemple début clé (debug):', (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').slice(0, 40));
      }
      this.enabled = false;
    }
  }

  /** Assure que la feuille est partagée publiquement si activé */
  async ensurePublicAccess() {
    if (!this.enabled || !this.autoPublic) return;
    try {
      await this.jwt.authorize();
      // Vérifier si une permission anyone existe déjà
      const perms = await this.drive.permissions.list({ fileId: this.sheetId, supportsAllDrives: false });
      const anyone = (perms.data.permissions || []).find(p => p.type === 'anyone');
      if (anyone) {
        // Déjà partagé - si rôle différent on pourrait le mettre à jour
        if (anyone.role !== this.publicRole) {
          await this.drive.permissions.update({ fileId: this.sheetId, permissionId: anyone.id, requestBody: { role: this.publicRole } });
          if (process.env.OCR_DEBUG === '1') console.log('🌐 Permission publique mise à jour ->', this.publicRole);
        }
        return;
      }
      // Créer la permission publique
      await this.drive.permissions.create({
        fileId: this.sheetId,
        requestBody: { type: 'anyone', role: this.publicRole },
        supportsAllDrives: false
      });
      console.log(`🌐 Feuille rendue publique (${this.publicRole})`);
    } catch (e) {
      console.warn('⚠️ Impossible de rendre le sheet public automatiquement:', e.message);
    }
  }

  /** Initialise les en-têtes si la feuille est vide */
  async ensureHeader() {
    try {
      await this.jwt.authorize();
      const res = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetId,
        range: 'Sheet1!A1:Z1'
      });
  const layout = 'simple'; // Forcé en simple pour répondre à la demande utilisateur
      const desired = layout === 'simple'
        ? [
            'NUM CLIENT','NOM CLIENT','CODE PRIVILÈGE','RÉFÉRENCE','TAILLE OU CODE','QUANTITÉ','PRIX UNITAIRE','TOTAL','DEVISE'
          ]
        : [
            'Horodatage','Nom complet','Numéro client','Code privilège','Téléphone',
            'Livraison domicile','Point relais principal','Autre point relais',
            'Index article','Nom produit','Coloris','Référence','Taille/Code','Quantité','Prix unitaire','Total ligne','Devise article',
            'Sous-total articles','Frais livraison','Total commande','Total avec frais','Devise totaux',
            'Confiance OCR','Confiance LLM','Score global','Fichier'
          ];
      const existing = res.data.values && res.data.values[0] ? res.data.values[0] : [];
      const mismatch = existing.length === 0 || existing.join('|') !== desired.join('|');
      if (mismatch) {
        const header = [ desired ];
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.sheetId,
          range: 'Sheet1!A1',
          valueInputOption: 'RAW',
          requestBody: { values: header }
        });
      }
    } catch (e) {
      console.warn('⚠️ ensureHeader Sheets:', e.message);
    }
  }

  /** Construit les lignes (une par article, ou une ligne vide si aucun article) */
  buildRows(extraction, quality = {}, meta = {}) {
    const d = new Date();
    const fmt = (v) => v == null ? '' : (typeof v === 'number' ? v : String(v));
    const client = extraction.client || {};
    const livraison = extraction.livraison || {};
    const totaux = extraction.totaux || {};
    const articles = Array.isArray(extraction.articles) && extraction.articles.length ? extraction.articles : [ {} ];
    const layout = 'simple';
    if (layout === 'simple') {
      return articles.map(a => {
        const numClient = (client.numero_client || a.page_catalogue || '').toString().replace(/[^A-Z0-9]/gi,'').slice(0,9);
        const codePriv = (client.code_privilege || a.code_privilege || '').toString().replace(/[^A-Z0-9]/gi,'').slice(0,4);
        return [
          fmt(numClient),
          fmt(client.nom_complet),
          fmt(codePriv),
          fmt(a.reference),
          fmt(a.taille_ou_code),
          fmt(a.quantite),
          fmt(a.prix_unitaire),
          fmt(a.total_ligne || (a.prix_unitaire && a.quantite ? Number(a.prix_unitaire) * Number(a.quantite) : '')),
          fmt(a.devise || extraction?.totaux?.devise || 'EUR')
        ];
      });
    }
    return articles.map((a, idx) => ([
      d.toISOString(),
      fmt(client.nom_complet),
      fmt(client.numero_client),
      fmt(client.code_privilege),
      fmt(client.telephone_portable || client.telephone_fixe),
      fmt(livraison.livraison_domicile),
      fmt(livraison.point_relais_principal),
      fmt(livraison.autre_point_relais),
      idx + 1,
      fmt(a.nom_produit),
      fmt(a.coloris),
      fmt(a.reference),
      fmt(a.taille_ou_code),
      fmt(a.quantite),
      fmt(a.prix_unitaire),
      fmt(a.total_ligne),
      fmt(a.devise || totaux.devise),
      fmt(totaux.sous_total_articles),
      fmt(totaux.participation_frais_livraison),
      fmt(totaux.total_commande),
      fmt(totaux.total_avec_frais),
      fmt(totaux.devise),
      fmt(quality.ocrConfidence),
      fmt(quality.llmConfidence),
      fmt(quality.overallConfidence),
      fmt(meta.filename)
    ]));
  }

  /** Ajoute (append) une extraction au sheet: une ligne par article */
  async appendExtraction(extraction, quality = {}, meta = {}) {
    if (!this.enabled) return { skipped: true };
    try {
      await this.jwt.authorize();
      await this.ensureHeader();
      await this.ensurePublicAccess();
      const rows = this.buildRows(extraction, quality, meta);
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.sheetId,
        range: 'Sheet1!A:A',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rows }
      });
      if (process.env.OCR_DEBUG === '1') console.log('🟢 Ligne ajoutée Google Sheet');
      return { success: true, rows: rows.length };
    } catch (e) {
      console.error('❌ Append Google Sheets:', e.message);
      return { success: false, error: e.message };
    }
  }

  /** Récupère toutes les lignes de Sheet1 (pour export) */
  async fetchAllRows() {
    if (!this.enabled) return { success: false, error: 'SERVICE_DISABLED' };
    try {
      await this.jwt.authorize();
      const res = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetId,
        range: 'Sheet1!A:Z'
      });
      const values = res.data.values || [];
      return { success: true, rows: values };
    } catch (e) {
      console.error('❌ Fetch Google Sheets:', e.message);
      return { success: false, error: e.message };
    }
  }
}

let singleton;
export function getGoogleSheetsService() {
  if (!singleton) singleton = new GoogleSheetsService();
  return singleton;
}

export default GoogleSheetsService;
