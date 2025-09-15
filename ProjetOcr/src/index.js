import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import ExtractionService from './services/extractionService.js';
import { getGoogleSheetsService } from './services/googleSheetsService.js';
import { getMySQLStorageService } from './services/mysqlStorageService.js';
import ExcelJS from 'exceljs';
import fs from 'fs';
import fetch from 'node-fetch';

// Configuration pour ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Charger les variables d'environnement
dotenv.config();
// Diagnostics variables d'environnement clés
console.log('[ENV DIAG] OCRSPACE_API_KEY length =', process.env.OCRSPACE_API_KEY ? process.env.OCRSPACE_API_KEY.length : 'ABSENT');
console.log('[ENV DIAG] GROQ_API_KEY length =', process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.length : 'ABSENT');
console.log('[ENV DIAG] USE_OCRSPACE =', process.env.USE_OCRSPACE);

// Handlers de debug pour comprendre l'arrêt silencieux du process
const installDebugHandlers = () => {
  if (global.__DEBUG_HANDLERS_INSTALLED__) return;
  global.__DEBUG_HANDLERS_INSTALLED__ = true;
  const logPrefix = '🛠 DEBUG PROCESS';
  process.on('beforeExit', (code) => {
    console.log(`${logPrefix} beforeExit code=${code}`);
  });
  process.on('exit', (code) => {
    console.log(`${logPrefix} exit code=${code}`);
  });
  process.on('uncaughtException', (err) => {
    console.error(`${logPrefix} uncaughtException:`, err); 
  });
  process.on('unhandledRejection', (reason, promise) => {
    console.error(`${logPrefix} unhandledRejection:`, reason);
  });
  ['SIGINT','SIGTERM','SIGHUP'].forEach(sig => {
    process.on(sig, () => {
      console.log(`${logPrefix} signal ${sig} reçu`);
    });
  });
  console.log('🔎 Handlers debug process installés');
};

installDebugHandlers();

// S'assurer que le dossier uploads existe (évite crash silencieux Multer)
const uploadsDir = 'uploads';
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('📁 Dossier uploads créé');
  }
} catch (e) {
  console.error('❌ Impossible de créer le dossier uploads:', e);
}

// Heartbeat interne pour vérifier si le process reste vivant
let lastBeat = Date.now();
setInterval(() => {
  lastBeat = Date.now();
}, 5000).unref();

// Initialiser le service d'extraction
const extractionService = new ExtractionService();

// Initialisation explicite MySQL (log précoce)
const mysqlServiceEarly = getMySQLStorageService();
if (!mysqlServiceEarly.enabled) {
  console.log('ℹ️ MySQL non activé (variables manquantes)');
} else {
  console.log('⏳ Initialisation MySQL...');
  mysqlServiceEarly.init().catch(e=>console.error('❌ Init MySQL échoué:', e.message));
}

const app = express();
// Sélection dynamique de port (3000-3010)
const pickPort = async (base = 3000, maxTries = 10) => {
  const net = await import('net');
  const tryPort = (p) => new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', err => {
      srv.close();
      resolve(false);
    });
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(p, '0.0.0.0');
  });
  for (let i = 0; i < maxTries; i++) {
    const port = base + i;
    /* eslint-disable no-await-in-loop */
    const free = await tryPort(port);
    if (free) return port;
  }
  return base; // fallback
};

let PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Route rapide de diagnostic MySQL très tôt
app.get('/mysql/early-status', (req,res)=>{
  const svc = mysqlServiceEarly;
  res.json({ enabled: svc.enabled, host: process.env.MYSQL_HOST||null, db: process.env.MYSQL_DATABASE||null });
});

// Configuration de multer pour l'upload de fichiers
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Accepter seulement les images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Seules les images sont autorisées!'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // Limite de 10MB
  }
});

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'Système OCR d\'extraction de références produits',
    version: '1.0.0',
    status: 'Démarré'
  });
});

// Route healthcheck
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    pid: process.pid,
    lastBeatAgeMs: Date.now() - lastBeat,
    memory: process.memoryUsage().rss
  });
});

// Route /health/full retirée (mode hybrid désactivé)

// Route pour vérifier le statut des services AI
app.get('/ai-status', async (req, res) => {
  try {
    const smartLLM = extractionService.llmService;
    const status = await smartLLM.getServicesStatus();
    
    res.json({
      success: true,
      services: status,
      currentService: smartLLM.currentService ? 'Initialisé' : 'Non sélectionné',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Route pour l'upload et traitement d'image
app.post('/extract', upload.single('image'), async (req, res) => {
  try {
    console.log('🚀 Début de la route /extract...');
    
    if (!req.file) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    console.log('📸 Image reçue:', req.file.filename);
    
    // Options d'extraction depuis les paramètres de requête
    const options = {
      preprocess: req.query.preprocess !== 'false',
      orientation: req.query.orientation !== 'false',
      threshold: req.query.threshold === 'true',
      thresholdValue: parseInt(req.query.thresholdValue) || 128,
      contextAnalysis: req.query.contextAnalysis !== 'false'
    };
    
    console.log('⚙️ Options d\'extraction:', options);
    console.log('🔧 Lancement de extractionService.extractReferences...');
    
    // Lancer le pipeline d'extraction avec gestion d'erreur robuste
    let result;
    try {
      result = await extractionService.extractReferences(req.file.path, options);
      console.log('✅ extractionService.extractReferences terminé avec succès');
    } catch (extractionError) {
      console.error('❌ Erreur dans extractionService.extractReferences:', extractionError);
      console.error('❌ Stack trace extraction:', extractionError.stack);
      
      // Retourner une erreur détaillée au lieu de faire planter le serveur
      return res.status(500).json({ 
        error: 'Erreur lors de l\'extraction',
        message: extractionError.message,
        stack: extractionError.stack,
        success: false
      });
    }
    
    console.log('📊 Formatage de la réponse...');
    
    // Déterminer si Google Sheets est actif pour fournir l'URL à l'UI
    const sheetsSvc = getGoogleSheetsService();
    const sheetUrl = sheetsSvc.enabled && process.env.GOOGLE_SHEET_ID
      ? `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}/edit`
      : null;

    // Formater la réponse pour l'API
    const response = {
      success: true,
      filename: req.file.filename,
      googleSheets: {
        enabled: !!sheetsSvc.enabled,
        sheetUrl
      },
      extraction: {
        data: result.output.extractedData,
        quality: {
          overallConfidence: result.output.quality.overallConfidence,
          ocrConfidence: result.output.quality.ocrConfidence,
          llmConfidence: result.output.quality.llmConfidence,
          textQuality: result.output.quality.textQuality.quality,
          method: result.output.quality.method
        },
        performance: {
          totalDuration: result.performance.totalDuration,
          steps: result.performance.steps
        }
      },
      metadata: {
        processedImagePath: result.output.metadata.processedImagePath,
        llmMethod: result.output.metadata.llmMethod,
          processingTime: result.output.metadata.processingTime,
          fallbackUsed: result.output.metadata.fallbackUsed || false
      }
    };
    
    // Sauvegarder les résultats pour le téléchargement
    lastExtractionResults = {
      extractedData: result.output.extractedData,
      quality: result.output.quality,
      ocrText: result.output.metadata?.ocrText || '',
      processingTime: result.performance.totalDuration,
      imageInfo: {
        filename: req.file.filename,
        size: req.file.size
      },
      smartLLMService: extractionService.llmService
    };

    // Envoi asynchrone vers Google Sheets (non bloquant)
    (async () => {
      try {
        const sheets = getGoogleSheetsService();
        if (!sheets.enabled) return;
        const appendRes = await sheets.appendExtraction(
          result.output.extractedData,
          result.output.quality,
          { filename: req.file.filename }
        );
        if (!appendRes.success && process.env.OCR_DEBUG === '1') {
          console.warn('⚠️ Append Google Sheets échoué:', appendRes.error);
        }
      } catch (e) {
        console.warn('⚠️ Erreur envoi Google Sheets:', e.message);
      }
    })();


    // Envoi asynchrone vers MySQL
    ;(async () => {
      try {
        const mysqlStore = getMySQLStorageService();
        const ins = await mysqlStore.insertExtraction(
          result.output.extractedData,
          result.output.quality,
          { filename: req.file.filename }
        );
        if (!ins.success && !ins.skipped && process.env.OCR_DEBUG === '1') {
          console.warn('⚠️ Insert MySQL échoué:', ins.error);
        } else if (ins.skipped) {
          console.warn('ℹ️ MySQL insertion skipped (service désactivé)');
        }
      } catch (e) {
        console.warn('⚠️ Erreur envoi MySQL:', e.message);
      }
    })();

    
    console.log(`✅ Extraction terminée: confiance ${result.output.quality.overallConfidence}`);
    res.json(response);
    
  } catch (error) {
    console.error('❌ Erreur générale lors du traitement:', error);
    console.error('❌ Stack trace générale:', error.stack);
    res.status(500).json({ 
      error: 'Erreur interne du serveur',
      message: error.message,
      stack: error.stack,
      success: false
    });
  }
});

// Route pour traitement par lots
app.post('/extract-batch', upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    console.log(`📦 Traitement par lots: ${req.files.length} images`);
    
    const imagePaths = req.files.map(file => file.path);
    const options = {
      preprocess: req.query.preprocess !== 'false',
      orientation: req.query.orientation !== 'false',
      threshold: req.query.threshold === 'true',
      contextAnalysis: req.query.contextAnalysis !== 'false'
    };
    
    const results = await extractionService.batchExtraction(imagePaths, options);
    
    res.json({
      success: true,
      totalFiles: req.files.length,
      results: results.map(result => ({
        filename: result.batchInfo?.filename,
        success: !result.error,
        error: result.error,
        references: result.output?.references.valid || [],
        confidence: result.output?.quality.overallConfidence || 0
      }))
    });
    
  } catch (error) {
    console.error('❌ Erreur traitement par lots:', error);
    res.status(500).json({ error: error.message });
  }
});

// Route pour mettre à jour la base de références
app.post('/references', express.json(), (req, res) => {
  try {
    const { references } = req.body;
    
    if (!Array.isArray(references)) {
      return res.status(400).json({ error: 'Le format doit être un tableau de références' });
    }
    
    extractionService.updateKnownReferences(references);
    
    res.json({
      success: true,
      message: `${references.length} références ajoutées`,
      totalReferences: extractionService.knownReferences.length
    });
    
  } catch (error) {
    console.error('❌ Erreur mise à jour références:', error);
    res.status(500).json({ error: error.message });
  }
});

// Route pour récupérer la liste des références connues
app.get('/references', (req, res) => {
  res.json({
    references: extractionService.knownReferences,
    count: extractionService.knownReferences.length
  });
});

// Variable pour stocker les derniers résultats
let lastExtractionResults = null;

// Route utilitaire (DEV) pour injecter un échantillon et tester l'export XLSX
// NE PAS utiliser en production (peut être protégée par un token si nécessaire)
app.post('/dev/inject-sample', (req, res) => {
  try {
    const sample = {
      client: {
        nom_complet: 'Madame WARK CASPAR',
        numero_client: '170605886',
        code_privilege: 'PRIV123',
        telephone_portable: '06 11 22 33 44'
      },
      livraison: {
        livraison_domicile: 'non',
        point_relais_principal: 'IMAGINA',
        autre_point_relais: 'BUREAU DE POSTE PLOGOFF'
      },
      articles: [
        { nom_produit: 'Concave TSHIRTS', coloris: 'BLANC', reference: '2818341', taille_ou_code: '800t', quantite: 1, prix_unitaire: 39.99, total_ligne: 39.99, devise: 'EUR' },
        { nom_produit: 'CALERA T. SIHRIS', coloris: 'ROGE', reference: '284.7082', quantite: 1, prix_unitaire: 45.99, total_ligne: 45.99, devise: 'EUR' },
        { nom_produit: 'DETAMIUS SANUITES', coloris: 'BLANC', reference: '2860531', quantite: 1, prix_unitaire: 32.99, total_ligne: 32.99, devise: 'EUR' }
      ],
      totaux: {
        sous_total_articles: 118.97,
        participation_frais_livraison: 6.49,
        total_commande: 125.46,
        total_avec_frais: 125.46,
        devise: 'EUR'
      },
      confidence: 0.9,
      method: 'injected'
    };
    lastExtractionResults = {
      extractedData: sample,
      quality: {
        ocrConfidence: 0,
        llmConfidence: 0.9,
        overallConfidence: 0.85,
        textQuality: { quality: 'good' },
        method: 'injected'
      },
      ocrText: 'Texte OCR simulé',
      processingTime: 1234,
      imageInfo: { filename: 'sample.jpg' }
    };
    res.json({ success: true, injected: true, articles: sample.articles.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Route pour télécharger les résultats en TXT
app.get('/download-results', async (req, res) => {
  try {
    if (!lastExtractionResults) {
      return res.status(404).json({ error: 'Aucun résultat d\'extraction disponible' });
    }
    const r = lastExtractionResults;
    const ex = r.extractedData || {};
    const timestamp = new Date().toLocaleString('fr-FR');
    const ocrText = r.ocrText || '';

    let txtContent = `EXTRACTION BON DE COMMANDE - ${timestamp}\n`;
    txtContent += `${'='.repeat(60)}\n\n`;

    // CLIENT
    txtContent += `👤 CLIENT:\n`;
    txtContent += `${'-'.repeat(50)}\n`;
    if (ex.client?.nom_complet) txtContent += `- Nom complet: ${ex.client.nom_complet}\n`;
    if (ex.client?.numero_client) txtContent += `- Numéro client: ${ex.client.numero_client}\n`;
    if (ex.client?.code_privilege) txtContent += `- Code privilège: ${ex.client.code_privilege}\n`;
    if (ex.client?.telephone_portable) txtContent += `- Téléphone portable: ${ex.client.telephone_portable}\n`;
    if (ex.client?.telephone_fixe) txtContent += `- Téléphone fixe: ${ex.client.telephone_fixe}\n`;
    if (ex.client?.date_naissance) txtContent += `- Date de naissance: ${ex.client.date_naissance}\n`;
    if (ex.client?.email) txtContent += `- Email: ${ex.client.email}\n`;

    // LIVRAISON
    txtContent += `\n📦 LIVRAISON:\n`;
    txtContent += `${'-'.repeat(50)}\n`;
    if (ex.livraison?.livraison_domicile) txtContent += `- Livraison domicile: ${ex.livraison.livraison_domicile}\n`;
    if (ex.livraison?.point_relais_principal) txtContent += `- Point relais principal: ${ex.livraison.point_relais_principal}\n`;
    if (ex.livraison?.autre_point_relais) txtContent += `- Autre point relais: ${ex.livraison.autre_point_relais}\n`;

    // ARTICLES
    txtContent += `\n�️ ARTICLES (${(ex.articles||[]).length}):\n`;
    txtContent += `${'-'.repeat(50)}\n`;
    if (Array.isArray(ex.articles) && ex.articles.length) {
      ex.articles.forEach((a,i)=>{
        txtContent += `\n# Article ${i+1}\n`;
        const add=(label,val)=>{ if(val!=null && val!=='') txtContent+=`- ${label}: ${val}\n`; };
        add('Page', a.page_catalogue);
        add('Nom produit', a.nom_produit);
        add('Coloris', a.coloris);
        add('Référence', a.reference);
        add('Taille/Code', a.taille_ou_code);
        add('Quantité', a.quantite);
        add('Prix unitaire', a.prix_unitaire);
        add('Total ligne', a.total_ligne);
        add('Devise', a.devise);
      });
    } else {
      txtContent += 'Aucun article détecté.\n';
    }

    // TOTAUX
    txtContent += `\n💰 TOTAUX:\n`;
    txtContent += `${'-'.repeat(50)}\n`;
    if (ex.totaux) {
      const t=ex.totaux; const add=(l,v)=>{ if(v!=null) txtContent+=`- ${l}: ${v}\n`; };
      add('Sous-total articles', t.sous_total_articles);
      add('Participation frais livraison', t.participation_frais_livraison);
      add('Total commande', t.total_commande);
      add('Total avec frais', t.total_avec_frais);
      add('Devise', t.devise);
    }

    // TECH
    txtContent += `\n🔧 TECHNIQUE:\n`;
    txtContent += `${'-'.repeat(50)}\n`;
    txtContent += `- Confiance OCR: ${r.quality?.ocrConfidence}\n`;
    txtContent += `- Confiance LLM: ${r.quality?.llmConfidence}\n`;
    txtContent += `- Score global: ${r.quality?.overallConfidence}\n`;
    txtContent += `- Modèle LLM: ${process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct'}\n`;
    txtContent += `- Moteur OCR: ocrspace\n`;
    txtContent += `- Temps pipeline: ${r.processingTime} ms\n`;

    // OCR TEXTE
    txtContent += `\n📝 TEXTE OCR COMPLET:\n`;
    txtContent += `${'-'.repeat(50)}\n`;
    txtContent += (ocrText || 'Aucun texte') + '\n';

    const filename = `extraction-results-${Date.now()}.txt`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(txtContent);
  } catch (error) {
    console.error('❌ Erreur génération fichier TXT:', error);
    res.status(500).json({ error: error.message });
  }
});

// Route pour exporter le dernier résultat en XLSX
app.get('/export-latest-xlsx', async (req, res) => {
  try {
    if (!lastExtractionResults) {
      return res.status(404).json({ error: 'Aucun résultat disponible pour export XLSX' });
    }

    const { extractedData, quality, processingTime, imageInfo } = lastExtractionResults;
    const client = extractedData.client || {};
    const livraison = extractedData.livraison || {};
    const articles = Array.isArray(extractedData.articles) ? extractedData.articles : [];
    const totaux = extractedData.totaux || {};
  // Forcer le mode simple demandé par l'utilisateur (ignorer full)
  const layout = 'simple';
  console.log('[XLSX EXPORT] Mode forcé: simple');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'OCR Extraction System';
    workbook.created = new Date();

    // (Plus de feuille Résumé en mode simple forcé)
    // Feuille unique Articles (format demandé)
    const simple = workbook.addWorksheet('Articles');
  const simpleHeaders = ['NUM CLIENT','NOM CLIENT','NOM DU MODÈLE','COLORIS','RÉFÉRENCE','TAILLE OU CODE','QUANTITÉ','PRIX UNITAIRE','TOTAL','DEVISE'];
    simple.addRow(simpleHeaders);
    articles.forEach(a => {
      let totalLigne = a.total_ligne;
      if ((totalLigne === undefined || totalLigne === null || totalLigne === '') && a.quantite != null && a.prix_unitaire != null) {
        const q = Number(a.quantite);
        const pu = Number(a.prix_unitaire);
        if (!isNaN(q) && !isNaN(pu)) totalLigne = +(q * pu).toFixed(2);
      }
      simple.addRow([
        client.numero_client || '',
        client.nom_complet || '',
        a.nom_produit || '',
        a.coloris || '',
        a.reference || '',
        a.taille_ou_code || '',
        a.quantite == null ? '' : a.quantite,
        a.prix_unitaire == null ? '' : a.prix_unitaire,
        totalLigne == null ? '' : totalLigne,
        a.devise || totaux.devise || ''
      ]);
    });
    simple.getRow(1).font = { bold: true };
    simple.columns.forEach(col => { let max=10; col.eachCell({includeEmpty:true},c=>{const l=(c.value?String(c.value).length:0)+2; if(l>max && l<40) max=l;}); col.width=max; });

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `extraction-latest-${Date.now()}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('❌ Erreur export XLSX:', error);
    res.status(500).json({ error: error.message });
  }
});

// Route pour exporter tout l'historique Google Sheet en XLSX
app.get('/sheet/export-xlsx', async (req, res) => {
  try {
    const sheets = getGoogleSheetsService();
    if (!sheets.enabled) {
      return res.status(400).json({ error: 'Google Sheets désactivé ou mal configuré' });
    }
    const all = await sheets.fetchAllRows();
    if (!all.success) {
      return res.status(500).json({ error: 'Impossible de récupérer les données', details: all.error });
    }
    const rows = all.rows;
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Historique');
    rows.forEach(r => ws.addRow(r));
    ws.getRow(1).font = { bold: true };
    if (ws.columnCount) {
      for (let i = 1; i <= ws.columnCount; i++) {
        const col = ws.getColumn(i);
        let max = 10;
        col.eachCell({ includeEmpty: true }, cell => {
          const len = (cell.value ? String(cell.value).length : 0) + 2;
            if (len > max && len < 80) max = len;
        });
        col.width = max;
      }
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `historique-extractions-${Date.now()}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('❌ Erreur export historique XLSX:', error);
    res.status(500).json({ error: error.message });
  }
});

// DEBUG: forcer création/en-tête de la feuille
app.get('/sheet/ensure-header', async (req, res) => {
  try {
    const sheets = getGoogleSheetsService();
    if (!sheets.enabled) return res.status(400).json({ error: 'Sheets désactivé' });
    await sheets.ensureHeader();
    const check = await sheets.fetchAllRows();
    return res.json({ success: true, firstRow: check.rows[0] || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DEBUG: renvoyer la dernière extraction manuellement
app.post('/sheet/resend-last', async (req, res) => {
  try {
    if (!lastExtractionResults) return res.status(404).json({ error: 'Aucune extraction en mémoire' });
    const sheets = getGoogleSheetsService();
    if (!sheets.enabled) return res.status(400).json({ error: 'Sheets désactivé' });
    const appendRes = await sheets.appendExtraction(
      lastExtractionResults.extractedData,
      lastExtractionResults.quality,
      { filename: lastExtractionResults.imageInfo?.filename }
    );
    if (!appendRes.success) return res.status(500).json({ error: 'Echec append Google Sheet', details: appendRes.error });
    return res.json({ success:true, sheetAppend: appendRes, sheetUrl: sheets.sheetUrl });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DEBUG: statut détaillé Sheets
app.get('/sheet/status', async (req, res) => {
  try {
    const sheets = getGoogleSheetsService();
    if (!sheets.enabled) return res.json({ enabled:false });
    const rows = await sheets.fetchAllRows();
    res.json({
      enabled: true,
      header: rows.success && rows.rows.length ? rows.rows[0] : null,
      rowCount: rows.success ? rows.rows.length : 0,
      layout: process.env.SHEETS_LAYOUT || 'simple'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Statut MySQL
app.get('/mysql/status', async (req, res) => {
  try {
    const mysqlStore = getMySQLStorageService();
    const st = await mysqlStore.stats();
    res.json(st);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Export MySQL en XLSX
app.get('/mysql/export-xlsx', async (req, res) => {
  try {
    const mysqlStore = getMySQLStorageService();
    const rows = await mysqlStore.exportAll();
    if (!rows.length) return res.status(404).json({ error: 'Aucune donnée' });
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('MySQLRows');
    const headers = ['ID','DATE','NUM CLIENT','NOM CLIENT','NOM DU MODÈLE','COLORIS','RÉFÉRENCE','TAILLE OU CODE','QUANTITÉ','PRIX UNITAIRE','TOTAL','DEVISE'];
    ws.addRow(headers);
    rows.forEach(r => ws.addRow([
      r.id, r.created_at, r.num_client, r.nom_client, r.nom_modele, r.coloris, r.reference, r.taille_ou_code,
      r.quantite, r.prix_unitaire, r.total, r.devise
    ]));
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach(col => { let max=10; col.eachCell({includeEmpty:true},c=>{const l=(c.value?String(c.value).length:0)+2; if(l>max && l<60) max=l;}); col.width=max; });
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Disposition','attachment; filename="mysql-export-'+Date.now()+'.xlsx"');
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error('❌ Export MySQL XLSX error:', e);
    res.status(500).json({ error: e.message });
  }
});


// ACTION: pousse la dernière extraction et renvoie le sheet complet en XLSX
app.post('/sheet/push-latest', async (req, res) => {
  try {
    const sheets = getGoogleSheetsService();
    if (!sheets.enabled) return res.status(400).json({ error: 'Sheets désactivé' });
    if (!lastExtractionResults) return res.status(404).json({ error: 'Aucune extraction disponible' });

    const append = await sheets.appendExtraction(
      lastExtractionResults.extractedData,
      lastExtractionResults.quality,
      { filename: lastExtractionResults.imageInfo?.filename }
    );
    if (!append.success) return res.status(500).json({ error: 'Echec append', details: append.error });

    // (Suppression insertion MySQL automatique pour push-latest selon nouvelle demande)

    // Récupère toutes les lignes et renvoie un XLSX
    const all = await sheets.fetchAllRows();
    if (!all.success) return res.status(500).json({ error: 'Impossible de relire la feuille', details: all.error });
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Sheet1');
    all.rows.forEach(r => ws.addRow(r));
    ws.getRow(1).font = { bold: true };
    for (let i=1;i<=ws.columnCount;i++) {
      const col = ws.getColumn(i);
      let max = 10;
      col.eachCell({ includeEmpty:true }, cell => {
        const len = (cell.value? String(cell.value).length:0)+2;
        if (len>max && len<80) max=len;
      });
      col.width = max;
    }
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', 'attachment; filename="google-sheet-latest.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(Buffer.from(buffer));
  } catch (e) {
    console.error('❌ /sheet/push-latest error', e);
    res.status(500).json({ error: e.message });
  }
});

// Fonctions d'extraction spécialisées pour les bons de commande
function extractPersonalInfo(text) {
  const info = {};
  
  // Nom (MADAME DUBUS CLAUDE)
  const nomMatch = text.match(/(?:MADAME|MONSIEUR|M\.|Mme)\s+([A-Z\s]+(?:CLAUDE|PIERRE|MARTIN|BERNARD|DUBUS|[A-Z]+))/i);
  if (nomMatch) info.nom = nomMatch[0].trim();
  
  // Numéro client (dans NUMÉRO Code)
  const numeroMatch = text.match(/NUMÉRO[^0-9]*([0-9A-Z]+)/i) || 
                     text.match(/CLIENT[^0-9]*([0-9A-Z]+)/i);
  if (numeroMatch) info.numeroClient = numeroMatch[1];
  
  // Code privilège 
  const codeMatch = text.match(/Code[^A-Z0-9]*([A-Z0-9]{3,})/i);
  if (codeMatch && codeMatch[1].length <= 6) info.codePrivilege = codeMatch[1];
  
  // Téléphone portable - patterns améliorés pour format 06 19 10 06 56 63 ET 24 06 56 01
  const telPatterns = [
    // Pattern pour téléphone format court (24 06 56 01) - PRIORITÉ HAUTE
    /(?:portable|téléphone|tel|mobile)[^0-9]*([0-9]{2}\s+[0-9]{2}\s+[0-9]{2}\s+[0-9]{2})/i,
    // Pattern pour téléphone complet standard (06 19 10 06 56 63)
    /(?:portable|téléphone|tel|mobile)[^0-9]*([0-9]{2}\s+[0-9]{2}\s+[0-9]{2}\s+[0-9]{2}\s+[0-9]{2}\s+[0-9]{2})/i,
    // Pattern simple pour format court direct (XX XX XX XX)
    /([0-9]{2}\s+[0-9]{2}\s+[0-9]{2}\s+[0-9]{2})(?!\s+[0-9])/,
    // Pattern pour téléphone avec erreurs OCR courantes
    /(?:portable|téléphone|tel|mobile)[^0-9]*([0-9S£UI]{2}[\s.]*[0-9S£UI]{2}[\s.]*[0-9S£UI]{2}[\s.]*[0-9S£UI]{2}[\s.]*[0-9S£UI]{2}[\s.]*[0-9S£UI]{2})/i,
    // Pattern spécifique pour le format détecté (À 24 06 S£ UI)
    /À\s*(\d{2})\s*(\d{2})\s*([S£UI0-9\s]{6,})/i,
    // Pattern pour numéros français standards (0X XX XX XX XX)
    /([0-9]{2}\s+[0-9]{2}\s+[0-9]{2}\s+[0-9]{2}\s+[0-9]{2})/,
    // Pattern large pour téléphone avec erreurs OCR
    /([0-9S£UI]{2}[\s.]*[0-9S£UI]{2}[\s.]*[0-9S£UI]{2}[\s.]*[0-9S£UI]{2}[\s.]*[0-9S£UI]{2}[\s.]*[0-9S£UI]{2})/,
    // Pattern général fallback
    /portable[^0-9]*([0-9\sS£UI.]{8,})/i,
    // Pattern pour numéros partiels mais exploitables
    /([0-9]{2}\s+[0-9]{2}\s+[0-9S£UI\s]{4,})/
  ];
  
  for (const pattern of telPatterns) {
    const telMatch = text.match(pattern);
    if (telMatch) {
      let tel = '';
      if (telMatch.length >= 4) {
        // Reconstituer le numéro complet
        tel = telMatch[1] + ' ' + telMatch[2] + ' ' + telMatch[3];
      } else {
        tel = telMatch[1] || telMatch[0];
      }
      
      console.log('🔍 Téléphone brut trouvé:', tel);
      
      // Nettoyer le téléphone (remplacer les erreurs OCR courantes de manière extensive)
      tel = tel.replace(/S/g, '5')      // S = 5
               .replace(/£/g, '6')      // £ = 6
               .replace(/U/g, '0')      // U = 0  
               .replace(/I/g, '1')      // I = 1
               .replace(/O/g, '0')      // O = 0
               .replace(/l/g, '1')      // l = 1
               .replace(/Z/g, '2')      // Z = 2
               .replace(/B/g, '8')      // B = 8
               .replace(/G/g, '6')      // G = 6
               .replace(/[^\d\s]/g, '') // Supprimer tout sauf chiffres et espaces
               .replace(/\s+/g, ' ')    // Normaliser espaces
               .trim();
      
      console.log('🧹 Téléphone nettoyé:', tel);
      
      // Formater en numéro français standard si possible
      const digits = tel.replace(/\s/g, '');
      if (digits.length >= 8) {
        info.telephone = tel;
        break;
      }
    }
  }
  
  // Date de naissance (chercher dans différents formats)
  const datePatterns = [
    // Pattern pour "Date de naissance : | A 2 6% 4443 |"
    /Date\s+de\s+naissance[^|]*\|\s*([A-Z0-9%\s]{6,})\s*\|/i,
    // Pattern général pour date après "naissance"
    /naissance[^0-9]*([A-Z0-9%\s]{8,})/i,
    // Pattern pour format entre barres
    /\|\s*([A-Z0-9%\s]{6,})\s*\|/,
    // Pattern pour "Ldout" qui semble être une erreur OCR
    /Date\s+de\s+naissance[^L]*L[a-z]+/i
  ];
  
  for (const pattern of datePatterns) {
    const dateMatch = text.match(pattern);
    if (dateMatch && dateMatch[1]) {
      let date = dateMatch[1];
      console.log('Date brute extraite:', date);
      
      // Conversion des erreurs OCR communes
      date = date.replace(/A/g, '1')      // A = 1
                 .replace(/6%/g, '03')    // 6% = 03
                 .replace(/4443/g, '1952') // 4443 = 1952
                 .replace(/L/g, '1')      // L = 1
                 .replace(/O/g, '0')      // O = 0
                 .replace(/S/g, '5')      // S = 5
                 .replace(/\s+/g, ' ')
                 .trim();
      
      console.log('Date nettoyée:', date);
      
      // Valider que c'est une date plausible
      if (date.length >= 6 && /\d/.test(date)) {
        info.dateNaissance = date;
        break;
      }
    }
  }
  
  // Si aucune date trouvée, chercher "Ldout" spécifiquement
  if (!info.dateNaissance && text.includes('Ldout')) {
    console.log('Détection de "Ldout" - probablement une date mal reconnue');
    info.dateNaissance = 'Date non lisible (OCR: Ldout)';
  }
  
  // Email
  const emailMatch = text.match(/E-mail[^@]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (emailMatch) info.email = emailMatch[1];
  
  return info;
}

function extractDetailedArticles(text) {
  const articles = [];
  
  console.log('=== ANALYSE EXTRACTION ARTICLES ===');
  console.log('Texte à analyser (extrait):', text.substring(0, 800));
  
  // D'abord chercher le nouveau format avec PAGE NOM DU MODÈLE COLORIS RÉFÉRENCE
  const newTablePattern = /PAGE\s+NOM\s+DU\s+MODÈLE\s+COLORIS\s+RÉFÉRENCE\s+TAILLE\s+OU\s+POINTURE\s+QUANTITÉ\s+PRIX\s+UNITAIRE\s+TOTAL/i;
  const newTableMatch = text.match(newTablePattern);
  
  if (newTableMatch) {
    console.log('🎯 NOUVEAU FORMAT DE TABLEAU DÉTECTÉ !');
    
    // Extraire la section après l'en-tête du tableau
    const afterHeader = text.substring(newTableMatch.index + newTableMatch[0].length);
    const lines = afterHeader.split('\n').slice(1, 15); // Prendre les 15 premières lignes après l'en-tête
    
    let articleIndex = 1;
    
    for (const line of lines) {
      if (line.trim().length < 10) continue; // Ignorer les lignes trop courtes
      
      console.log(`📝 Analyse ligne tableau ${articleIndex}:`, line);
      
      // Pattern pour lignes d'articles avec numéro de page
      // Format attendu: "197 Coupe-coeur anti-foideur long Code A0 ... 313,628€"
      const patterns = [
        // Pattern principal pour articles avec page et prix
        /^(\d{2,3})\s+([^0-9]+?)\s+(Code\s+[A-Z0-9?]+)\s+.*?(\d+[,.]\d+)\s*€/i,
        // Pattern alternatif pour articles sans code mais avec prix  
        /^(\d{2,3})\s+([^0-9]{8,40}?)\s+.*?(\d+[,.]\d+)\s*€/i,
        // Pattern simple pour lignes avec page et texte
        /^(\d{2,3})\s+([^0-9]{8,})/i
      ];
      
      let matched = false;
      
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          const article = {
            numero: articleIndex,
            page: match[1].trim(),
            modele: match[2] ? match[2].trim().replace(/\s+/g, ' ') : '',
            coloris: '',
            reference: match[3] && match[3].includes('Code') ? match[3].trim() : '',
            taille: '',
            quantite: '1', 
            prixUnitaire: match[4] ? match[4].replace(',', '.') + ' €' : '',
            total: match[4] ? match[4].replace(',', '.') + ' €' : ''
          };
          
          // Nettoyer le modèle
          article.modele = article.modele.replace(/[^\w\s\-]/g, '').trim();
          if (article.modele.length > 50) {
            article.modele = article.modele.substring(0, 50) + '...';
          }
          
          // Chercher le code dans la ligne si pas encore trouvé
          if (!article.reference) {
            const codeMatch = line.match(/(Code\s+[A-Z0-9?]+)/i);
            if (codeMatch) {
              article.reference = codeMatch[1];
            }
          }
          
          console.log('✅ Article du nouveau format extrait:', article);
          articles.push(article);
          articleIndex++;
          matched = true;
          break;
        }
      }
      
      if (!matched && line.includes('€')) {
        console.log('⚠️ Ligne avec € non reconnue:', line);
      }
    }
    
    console.log(`🎉 ${articles.length} articles extraits du nouveau format`);
    return articles; // Retourner immédiatement si on a trouvé le nouveau format
  }
  
  // Sinon, chercher l'ancien format
  console.log('🔍 Recherche ancien format...');
  const tableHeaderPattern = /NOM\s+OU\s+MODÈLE.*?cocons.*?REFERENCE.*?TAULEOU.*?\n(.*?)(?=\n\s*\n|\n[A-Z\s]{10,}|$)/s;
  const tableMatch = text.match(tableHeaderPattern);
  
  if (tableMatch && tableMatch[1]) {
    console.log('Section tableau détectée:', tableMatch[1]);
    
    const tableContent = tableMatch[1];
    const articleLines = tableContent.split('\n').filter(line => line.trim().length > 10);
    
    let articleIndex = 1;
    
    for (const line of articleLines) {
      console.log(`Analyse ligne ${articleIndex}:`, line);
      
      // Pattern spécifique pour la ligne détectée: "A Cour cfa anti —Kaduos bnes Code A0 $ A3, G684 cod AAC 99 MSI €"
      if (line.includes('Cour') && line.includes('Code') && line.includes('€')) {
        console.log('Ligne d\'article potentielle détectée');
        
        // Extraire les éléments
        const codeMatch = line.match(/(Code\s+[A-Z0-9]+)/i);
        const priceMatches = line.match(/(\d+[,.]?\d*)\s*€/g);
        const modelMatch = line.match(/([A-Z]?\s*Cour[^€]*?)(?=Code|\$|€)/i);
        
        if (codeMatch || priceMatches) {
          const article = {
            numero: articleIndex,
            page: '',
            modele: modelMatch ? modelMatch[1].trim().replace(/[—$\|]/g, ' ').replace(/\s+/g, ' ') : 'Cour',
            coloris: codeMatch ? codeMatch[1].replace('Code ', '') : '',
            reference: codeMatch ? codeMatch[1] : '',
            taille: '',
            quantite: '1',
            prixUnitaire: priceMatches ? priceMatches[priceMatches.length - 1] : '',
            total: priceMatches ? priceMatches[priceMatches.length - 1] : ''
          };
          
          // Nettoyer le modèle
          if (article.modele.includes('cfa') || article.modele.includes('anti')) {
            article.modele = 'Cour'; // Simplifier si trop de bruit OCR
          }
          
          console.log('Article extrait:', article);
          articles.push(article);
          articleIndex++;
        }
      }
      
      // Pattern pour autres lignes d'articles potentielles
      if (line.match(/Blogs.*?déqcue.*?€/i)) {
        const article = {
          numero: articleIndex,
          page: '',
          modele: 'Blogs déqcue',
          coloris: '',
          reference: 'BLOGS001',
          taille: '',
          quantite: '1',
          prixUnitaire: '',
          total: ''
        };
        
        const priceMatch = line.match(/(\d+[,.]?\d*)\s*€/);
        if (priceMatch) {
          article.prixUnitaire = priceMatch[0];
          article.total = priceMatch[0];
        }
        
        console.log('Article Blogs extrait:', article);
        articles.push(article);
        articleIndex++;
      }
    }
  }
  
  // Si aucun article trouvé dans le tableau, recherche globale
  if (articles.length === 0) {
    console.log('Aucun article trouvé dans le tableau, recherche globale...');
    
    const lines = text.split('\n');
    let articleIndex = 1;
    
    for (const line of lines) {
      // Chercher des lignes contenant des indicateurs d'articles
      if ((line.includes('Cour') || line.includes('Blogs')) && 
          (line.includes('Code') || line.includes('€'))) {
        
        console.log('Ligne article potentielle:', line);
        
        const article = {
          numero: articleIndex++,
          page: '',
          modele: '',
          coloris: '',
          reference: '',
          taille: '',
          quantite: '1',
          prixUnitaire: '',
          total: ''
        };
        
        // Extraire le modèle
        if (line.includes('Cour')) {
          article.modele = 'Cour';
        } else if (line.includes('Blogs')) {
          article.modele = 'Blogs';
        }
        
        // Extraire le code
        const codeMatch = line.match(/(Code\s+[A-Z0-9]+)/i);
        if (codeMatch) {
          article.reference = codeMatch[1];
          article.coloris = codeMatch[1].replace('Code ', '');
        }
        
        // Extraire le prix
        const priceMatch = line.match(/(\d+[,.]?\d*)\s*€/);
        if (priceMatch) {
          article.prixUnitaire = priceMatch[0];
          article.total = priceMatch[0];
        }
        
        if (article.modele) {
          articles.push(article);
        }
      }
    }
  }
  
  console.log(`Total d'articles extraits: ${articles.length}`);
  return articles;
}

// Démarrage du serveur
// Démarrage avec sélection dynamique
(async () => {
  // Initialisation MySQL tôt
  try {
    const mysqlSvc = getMySQLStorageService();
    if (mysqlSvc.enabled) {
      await mysqlSvc.init();
      console.log('🗄️  MySQL initialisé au démarrage');
    } else {
      console.log('ℹ️ MySQL non activé (variables manquantes)');
    }
  } catch (e) {
    console.error('❌ Échec init MySQL démarrage:', e.message);
  }
  const chosen = await pickPort(PORT, 11);
  if (chosen !== PORT) {
    console.log(`🔀 Port ${PORT} occupé, utilisation du port libre ${chosen}`);
    PORT = chosen;
  }
  app.listen(PORT, () => {
    console.log(`🚀 Serveur démarré sur le port ${PORT}`);
    console.log(`📝 Interface disponible sur http://localhost:${PORT}`);
    try {
      fs.writeFileSync('server_port.txt', String(PORT), 'utf8');
      console.log('📝 Port écrit dans server_port.txt');
    } catch (e) {
      console.warn('⚠️ Impossible d\'écrire server_port.txt:', e.message);
    }
  });
})();

export default app;