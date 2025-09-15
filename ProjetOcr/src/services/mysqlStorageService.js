import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Charge .env précocement (au cas où index.js ne l'a pas encore fait)
try {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
} catch {}

/*
 MySQL storage service
 - Creates required tables if not exist (schema aligned with Google Sheet simple layout)
 - Provides method to insert extraction (one row per article)
 - Graceful disable if env vars missing
*/

// MYSQL_PASSWORD peut être vide (root sans mot de passe en local XAMPP)
const REQUIRED_ENV = [ 'MYSQL_HOST','MYSQL_USER','MYSQL_DATABASE' ];

function envReady() {
  return REQUIRED_ENV.every(k => process.env[k]);
}

export class MySQLStorageService {
  constructor() {
    this.enabled = envReady();
    this.debug = process.env.MYSQL_DEBUG === '1';
    if (!this.enabled) {
      console.warn('ℹ️ MySQLStorageService désactivé: variables manquantes');
      return;
    }
    if (this.debug) {
      console.log('🔎 MySQL ENV:', {
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER,
        db: process.env.MYSQL_DATABASE,
        pwd_len: process.env.MYSQL_PASSWORD ? process.env.MYSQL_PASSWORD.length : 0
      });
    }
    this.pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      port: process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306,
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true
    });
  }

  async init() {
    if (!this.enabled) return;
    const ddl = `CREATE TABLE IF NOT EXISTS sheet_rows (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      num_client VARCHAR(64),
      nom_client VARCHAR(255),
      code_privilege VARCHAR(120),
      reference VARCHAR(120),
      taille_ou_code VARCHAR(120),
      quantite DECIMAL(12,3),
      prix_unitaire DECIMAL(12,2),
      total DECIMAL(12,2),
      devise VARCHAR(12)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
    const conn = await this.pool.getConnection();
    try {
      await conn.query(ddl);
      console.log('✅ MySQL table sheet_rows prête');
    } finally {
      conn.release();
    }
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
        num_client: (client.numero_client || '').toString().replace(/[^A-Z0-9]/gi,'').slice(0,9),
        nom_client: client.nom_complet || '',
        code_privilege: (client.code_privilege || a.code_privilege || '').toString().replace(/[^A-Z0-9]/gi,'').slice(0,4),
        reference: a.reference || '',
        taille_ou_code: a.taille_ou_code || '',
        quantite: a.quantite != null && a.quantite !== '' ? a.quantite : null,
        prix_unitaire: a.prix_unitaire != null && a.prix_unitaire !== '' ? a.prix_unitaire : null,
        total: total != null && total !== '' ? total : null,
        devise: a.devise || extraction?.totaux?.devise || 'EUR'
      };
    });
  }

  async insertExtraction(extraction, quality={}, meta={}) {
    if (!this.enabled) return { skipped:true };
    const rows = this.buildRows(extraction, quality, meta);
    const conn = await this.pool.getConnection();
    try {
      const sql = `INSERT INTO sheet_rows
        (num_client, nom_client, code_privilege, reference, taille_ou_code, quantite, prix_unitaire, total, devise)
        VALUES ?`;
      const values = rows.map(r => [r.num_client, r.nom_client, r.code_privilege, r.reference, r.taille_ou_code, r.quantite, r.prix_unitaire, r.total, r.devise]);
      await conn.query(sql, [values]);
      return { success:true, inserted: rows.length };
    } catch (e) {
      console.error('❌ MySQL insert error:', e.message);
      return { success:false, error: e.message };
    } finally {
      conn.release();
    }
  }

  async stats() {
    if (!this.enabled) return { enabled:false };
    const conn = await this.pool.getConnection();
    try {
      const [r] = await conn.query('SELECT COUNT(*) as count FROM sheet_rows');
      return { enabled:true, rows: r[0].count };
    } catch (e) {
      return { enabled:true, error: e.message };
    } finally {
      conn.release();
    }
  }

  async exportAll(limit=50000) {
    if (!this.enabled) return [];
    const conn = await this.pool.getConnection();
    try {
  const [rows] = await conn.query(`SELECT id, created_at, num_client, nom_client, code_privilege, reference, taille_ou_code, quantite, prix_unitaire, total, devise FROM sheet_rows ORDER BY id DESC LIMIT ?`, [limit]);
      return rows;
    } catch (e) {
      console.error('❌ exportAll MySQL error:', e.message);
      return [];
    } finally {
      conn.release();
    }
  }
  // Dedup supprimé (plus de colonne source_filename)
}

let singleton;
export function getMySQLStorageService() {
  if (!singleton) {
    singleton = new MySQLStorageService();
    if (singleton.enabled) {
      singleton.init().catch(e=>console.error('Init MySQL failed', e));
    }
  }
  return singleton;
}

export default MySQLStorageService;
