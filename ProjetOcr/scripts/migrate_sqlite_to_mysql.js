// Migration script: SQLite (legacy) -> MySQL sheet_rows
// Usage: node scripts/migrate_sqlite_to_mysql.js path/to/ocr_data.db
// Requires mysql2 (configured via .env) and better-sqlite3 installed temporarily if DB still present.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

async function run() {
  const sqlitePath = process.argv[2] || path.join(process.cwd(), 'data', 'ocr_data.db');
  if (!fs.existsSync(sqlitePath)) {
    console.error('SQLite file not found:', sqlitePath);
    process.exit(1);
  }
  let sqlite;
  try {
    sqlite = (await import('better-sqlite3')).default;
  } catch (e) {
    console.error('Install better-sqlite3 first: npm i better-sqlite3');
    process.exit(1);
  }
  const db = new sqlite(sqlitePath);
  const rows = db.prepare('SELECT * FROM sheet_rows ORDER BY id ASC').all();
  console.log('Rows to migrate:', rows.length);
  if (!rows.length) return;

  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    port: process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306,
    waitForConnections: true,
    connectionLimit: 5
  });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const sql = `INSERT INTO sheet_rows
      (num_client, nom_client, nom_modele, coloris, reference, taille_ou_code, quantite, prix_unitaire, total, devise, source_filename, ocr_conf, llm_conf, overall_conf)
      VALUES ?`;
    const values = rows.map(r => [r.num_client, r.nom_client, r.nom_modele, r.coloris, r.reference, r.taille_ou_code, r.quantite, r.prix_unitaire, r.total, r.devise, r.source_filename, r.ocr_conf, r.llm_conf, r.overall_conf]);
    await conn.query(sql, [values]);
    await conn.commit();
    console.log('Migration done');
  } catch (e) {
    await conn.rollback();
    console.error('Migration failed:', e.message);
  } finally {
    conn.release();
    await pool.end();
  }
}
run().catch(e=>{ console.error(e); process.exit(1); });
