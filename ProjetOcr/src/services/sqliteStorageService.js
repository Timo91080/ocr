import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

/*
  SQLite storage (portable) replacing MySQL for sharing.
  Creates a single DB file at ./data/ocr_data.db
  Table: sheet_rows (same logical columns as Google Sheet + confidences)
*/

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'ocr_data.db');

export class SQLiteStorageService {
  constructor() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    this.db = new Database(DB_PATH);
    this.init();
  }

  init() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS sheet_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      num_client TEXT,
      nom_client TEXT,
      nom_modele TEXT,
      coloris TEXT,
      reference TEXT,
      taille_ou_code TEXT,
      quantite REAL,
      prix_unitaire REAL,
      total REAL,
      devise TEXT,
      source_filename TEXT,
      ocr_conf REAL,
      llm_conf REAL,
      overall_conf REAL
    );`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reference ON sheet_rows(reference);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_num_client ON sheet_rows(num_client);`);
    console.log('✅ SQLite sheet_rows prête:', DB_PATH);
  }

  buildRows(extraction, quality={}, meta={}) {
    const client = extraction.client || {};
    const articles = Array.isArray(extraction.articles) && extraction.articles.length ? extraction.articles : [ {} ];
    return articles.map(a => {
      let total = a.total_ligne;
      if ((total == null || total === '') && a.prix_unitaire!=null && a.quantite!=null) {
        const q = Number(a.quantite); const pu = Number(a.prix_unitaire);
        if (!isNaN(q) && !isNaN(pu)) total = +(q*pu).toFixed(2);
      }
      return {
        num_client: client.numero_client || '',
        nom_client: client.nom_complet || '',
        nom_modele: a.nom_produit || '',
        coloris: a.coloris || '',
        reference: a.reference || '',
        taille_ou_code: a.taille_ou_code || '',
        quantite: a.quantite != null && a.quantite !== '' ? Number(a.quantite) : null,
        prix_unitaire: a.prix_unitaire != null && a.prix_unitaire !== '' ? Number(a.prix_unitaire) : null,
        total: total != null && total !== '' ? Number(total) : null,
        devise: a.devise || extraction?.totaux?.devise || 'EUR',
        source_filename: meta.filename || null,
        ocr_conf: quality.ocrConfidence ?? null,
        llm_conf: quality.llmConfidence ?? null,
        overall_conf: quality.overallConfidence ?? null
      };
    });
  }

  insertExtraction(extraction, quality={}, meta={}) {
    const rows = this.buildRows(extraction, quality, meta);
    const stmt = this.db.prepare(`INSERT INTO sheet_rows
      (num_client, nom_client, nom_modele, coloris, reference, taille_ou_code, quantite, prix_unitaire, total, devise, source_filename, ocr_conf, llm_conf, overall_conf)
      VALUES (@num_client, @nom_client, @nom_modele, @coloris, @reference, @taille_ou_code, @quantite, @prix_unitaire, @total, @devise, @source_filename, @ocr_conf, @llm_conf, @overall_conf)`);
    const insertMany = this.db.transaction((records) => {
      for (const r of records) stmt.run(r);
    });
    try {
      insertMany(rows);
      return { success:true, inserted: rows.length };
    } catch (e) {
      console.error('❌ SQLite insert error:', e.message);
      return { success:false, error: e.message };
    }
  }

  stats() {
    try {
      const row = this.db.prepare('SELECT COUNT(*) as count FROM sheet_rows').get();
      return { enabled:true, rows: row.count, dbPath: DB_PATH };
    } catch (e) {
      return { enabled:false, error: e.message };
    }
  }

  exportAll() {
    const rows = this.db.prepare('SELECT * FROM sheet_rows ORDER BY id DESC').all();
    return rows;
  }
}

let singleton;
export function getSQLiteStorageService() {
  if (!singleton) singleton = new SQLiteStorageService();
  return singleton;
}

export default SQLiteStorageService;
