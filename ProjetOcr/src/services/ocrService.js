import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import fetch from 'node-fetch';
import sharp from 'sharp';

// OCR.space unique avec compression + double tentative + logs debug
const OCRSPACE_ENDPOINT = process.env.OCRSPACE_URL || 'https://api.ocr.space/parse/image';
const TARGET_MAX_BYTES = 850 * 1024; // marge sous 1MB plan gratuit
const MAX_WIDTH = 1700; // redimension si très large

class OCRService {
  constructor() {
    this.apiKey = process.env.OCRSPACE_API_KEY;
    this.debug = process.env.OCR_DEBUG === '1';
    this.maxRetries = parseInt(process.env.OCR_RETRIES || '2');
    this.baseTimeout = parseInt(process.env.OCR_TIMEOUT_MS || '45000');
    this.enableVariants = process.env.OCR_MULTI_VARIANTS === '1';
    this.maxVariants = parseInt(process.env.OCR_MAX_VARIANTS || '4');
    if (!this.apiKey) console.warn('⚠️ OCRSPACE_API_KEY manquant');
    if (this.debug) console.log('🟡 OCR DEBUG activé');
    if (!fs.existsSync('logs')) {
      try { fs.mkdirSync('logs'); } catch {}
    }
  }

  async extractText(imagePath) {
    const t0 = Date.now();
    try {
      console.log('📤 OCR.space pipeline');
      if (!this.enableVariants) {
        const { optimizedPath, originalSize, finalSize, meta } = await this.optimizeIfNeeded(imagePath);
        const result = await this.runWithRetries(optimizedPath);
        const duration = Date.now() - t0;
        console.log(`✅ OCR terminé (${result.lines.length} lignes, pass=${result.pass}, ${(result.avgConfidence*100).toFixed(1)}% conf) en ${duration}ms`);
        return {
          text: result.lines.map(l=>l.text).join('\n'),
          confidence: (result.avgConfidence||0)*100,
          words: result.lines,
          lines: result.lines,
          engine: 'ocrspace',
          debug: this.debug ? {
            originalKB: +(originalSize/1024).toFixed(1),
            sentKB: +(finalSize/1024).toFixed(1),
            width: meta?.width,
            height: meta?.height,
            passUsed: result.pass,
            variants: 1
          } : undefined,
          duration
        };
      }

      // Mode avancé multi-variantes
      const variants = await this.generateVariants(imagePath, this.maxVariants);
      const results = [];
      for (const v of variants) {
        try {
          const r = await this.runWithRetries(v.path);
          const joined = r.lines.map(l=>l.text).join(' ');
          const score = this.estimateReadability(joined, r.avgConfidence);
          results.push({ variant: v, ocr: r, score, text: joined });
        } catch (e) {
          if (this.debug) console.warn('⚠️ Variante OCR échouée:', v.label, e.message);
        }
      }
      if (!results.length) throw new Error('Aucune variante OCR réussie');
      // Trier par score décroissant
      results.sort((a,b)=> b.score - a.score);
      const best = results[0];
      const merged = this.mergeVariantTexts(results.map(r=>r.text));
      const duration = Date.now() - t0;
      console.log(`✅ OCR multi-variantes terminé. Best='${best.variant.label}' score=${best.score.toFixed(3)} variants=${results.length}`);
      return {
        text: merged,
        confidence: (best.ocr.avgConfidence||0)*100,
        words: best.ocr.lines,
        lines: best.ocr.lines,
        engine: 'ocrspace',
        debug: this.debug ? {
          variantsTried: results.length,
            bestVariant: best.variant.label,
          scores: results.map(r=>({ label: r.variant.label, score: r.score, conf: (r.ocr.avgConfidence||0) })),
          mergedLength: merged.length
        } : undefined,
        duration
      };
    } catch (error) {
      console.error('❌ Erreur OCR.space:', error.message);
      throw new Error(`Erreur OCR.space: ${error.message}`);
    }
  }

  async optimizeIfNeeded(srcPath) {
    const stat = fs.statSync(srcPath);
    let finalPath = srcPath;
    let finalSize = stat.size;
    let meta;
    try { meta = await sharp(srcPath).metadata(); } catch {}
    const needResize = meta?.width && meta.width > MAX_WIDTH;
    const needCompress = stat.size > TARGET_MAX_BYTES || needResize;
    if (!needCompress) {
      if (this.debug) console.log(`🟡 Pas de recompression: ${(stat.size/1024).toFixed(0)}KB (w:${meta?.width} h:${meta?.height})`);
      return { optimizedPath: finalPath, originalSize: stat.size, finalSize, meta };
    }
    const outPath = path.join(path.dirname(srcPath), path.basename(srcPath, path.extname(srcPath)) + '_ocr.jpg');
    let pipeline = sharp(srcPath).rotate();
    if (needResize) pipeline = pipeline.resize({ width: MAX_WIDTH });
    await pipeline.jpeg({ quality: 70, mozjpeg: true }).toFile(outPath);
    finalSize = fs.statSync(outPath).size;
    if (finalSize > TARGET_MAX_BYTES) {
      await sharp(outPath).jpeg({ quality: 55, mozjpeg: true }).toFile(outPath + '.tmp.jpg');
      fs.renameSync(outPath + '.tmp.jpg', outPath);
      finalSize = fs.statSync(outPath).size;
    }
    if (this.debug) console.log(`🗜 Compression: ${(stat.size/1024).toFixed(0)}KB -> ${(finalSize/1024).toFixed(0)}KB (w:${meta?.width} h:${meta?.height})`);
    return { optimizedPath: outPath, originalSize: stat.size, finalSize, meta };
  }

  async callOcr(imagePath, mode='primary') {
    if (!this.apiKey) throw new Error('OCRSPACE_API_KEY manquant');
    const lang = process.env.OCRSPACE_LANGUAGE || 'fre';
    const form = new FormData();
    form.append('language', lang);
    form.append('scale', 'true');
    form.append('detectOrientation', 'true');
    if (mode === 'primary') {
      form.append('isOverlayRequired', 'true');
      form.append('OCREngine', process.env.OCRSPACE_ENGINE || '2');
      if (process.env.OCRSPACE_IS_TABLE === '1') form.append('isTable', 'true');
    } else {
      form.append('isOverlayRequired', 'false');
    }
    form.append('file', fs.createReadStream(imagePath), path.basename(imagePath));

  const res = await fetch(OCRSPACE_ENDPOINT, { method: 'POST', headers: { apikey: this.apiKey }, body: form, timeout: this.baseTimeout });
    const raw = await res.text();
    let json;
    try { json = JSON.parse(raw); } catch {
      this.saveRaw(raw, mode, 'parse_error');
      throw new Error('Réponse non JSON');
    }
    this.saveRaw(json, mode, 'ok');
    if (this.debug) {
      console.log(`🟡 OCR(${mode}) exit=${json.OCRExitCode} errored=${json.IsErroredOnProcessing}`);
      if (json.ErrorMessage) console.log('🟠 ErrorMessage:', json.ErrorMessage);
      if (json.ErrorDetails) console.log('🟠 ErrorDetails:', json.ErrorDetails);
      if (json.RemainingCredits != null) console.log('🔢 RemainingCredits:', json.RemainingCredits);
    }
    if (json.IsErroredOnProcessing) {
      const msg = Array.isArray(json.ErrorMessage) ? json.ErrorMessage.join(' | ') : (json.ErrorMessage || 'Erreur inconnue');
      throw new Error(msg);
    }
    if (!json.ParsedResults || !json.ParsedResults[0]) throw new Error('Réponse OCR.space invalide');
    const lines = [];
    json.ParsedResults.forEach(pr => {
      if (pr.TextOverlay?.Lines) {
        pr.TextOverlay.Lines.forEach(L => {
          const lineText = L.Words.map(w=>w.WordText).join(' ');
          const avgConf = L.Words.reduce((a,w)=>a + (parseFloat(w.WordConfidence)||0),0)/(L.Words.length||1);
          lines.push({ text: lineText, confidence: (avgConf/100) });
        });
      } else if (pr.ParsedText) {
        // fallback découpage basique
        pr.ParsedText.split('\n').forEach(rawLine => {
          const t = rawLine.trim(); if (t) lines.push({ text: t, confidence: 0.5 });
        });
      }
    });
    const avgConfidence = lines.length ? lines.reduce((a,l)=>a+l.confidence,0)/lines.length : 0;
    return { lines, avgConfidence, pass: mode };
  }

  async runWithRetries(imagePath){
    let lastErr; let attempt=0; let mode='primary';
    while(attempt <= this.maxRetries){
      try {
        if(this.debug) console.log(`🔁 OCR tentative ${attempt+1}/${this.maxRetries+1} mode=${mode}`);
        const r = await this.callOcr(imagePath, mode);
        return r;
      } catch(e){
        lastErr = e;
        const timeoutLike = /timeout|network/i.test(e.message);
        const rateLimit = /quota|credits|too many/i.test(e.message);
        if(rateLimit){
          if(this.debug) console.warn('⛔ Arrêt retries (quota)');
          break;
        }
        if(timeoutLike && mode==='primary'){
          mode='light'; // downgrade
        } else if(timeoutLike && mode==='light'){ // agressive compress fallback
          const shrunk = await this.aggressiveShrink(imagePath);
          imagePath = shrunk; // replace path
        }
        attempt++;
        if(attempt>this.maxRetries) break;
        await new Promise(r=>setTimeout(r, 800 * attempt));
        continue;
      }
    }
    throw lastErr || new Error('OCR échec inconnu');
  }

  async aggressiveShrink(p){
    try{
      const out = p.replace(/_ocr\.jpg$/, '_ocr_small.jpg');
      await sharp(p).resize({ width: 1200 }).jpeg({ quality: 50, mozjpeg: true }).toFile(out);
      if(this.debug){
        const s = fs.statSync(out).size; console.log('🗜 Shrink agressif ->', (s/1024).toFixed(0)+'KB');
      }
      return out;
    }catch(e){
      if(this.debug) console.warn('⚠️ Shrink agressif échec:', e.message);
      return p;
    }
  }

  saveRaw(data, mode, tag) {
    if (!this.debug) return;
    try {
      const file = path.join('logs', `ocrspace_${mode}_${tag}.json`);
      fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    } catch {}
  }

  /** Génère des variantes de prétraitement (sharp) */
  async generateVariants(srcPath, limit=4){
    const buf = await sharp(srcPath).rotate().toBuffer();
    const variants = [];
    const push = async (label, pipeline) => {
      const out = srcPath.replace(/(\.[a-zA-Z]+)$/,'_'+label+'.jpg');
      await pipeline.toFile(out);
      variants.push({ label, path: out });
    };
    // Base
    await push('base', sharp(buf).jpeg({ quality:78, mozjpeg:true }));
    if (variants.length>=limit) return variants;
    await push('grayscale', sharp(buf).grayscale().normalize().jpeg({ quality:82 }));
    if (variants.length>=limit) return variants;
    await push('contrast', sharp(buf).linear(1.3, -25).modulate({ brightness:1.07, contrast:1.2, saturation:1.02 }).sharpen().jpeg({ quality:72 }));
    if (variants.length>=limit) return variants;
    await push('threshold', sharp(buf).grayscale().threshold(138).jpeg({ quality:88 }));
    if (variants.length>=limit) return variants;
    await push('light_dilate', sharp(buf).grayscale().normalize().sharpen().median(1).jpeg({ quality:80 }));
    if (variants.length>=limit) return variants.slice(0, limit);
    await push('invert_threshold', sharp(buf).grayscale().negate().threshold(130).jpeg({ quality:85 }));
    return variants.slice(0, limit);
  }

  /** Score heuristique de lisibilité combinant longueur filtrée et confiance moyenne */
  estimateReadability(text, avgConf){
    const clean = text.replace(/[^A-Za-z0-9€%\s]/g,'');
    const words = clean.split(/\s+/).filter(w=>w.length>2);
    const digitDensity = (clean.match(/\d/g)||[]).length / (clean.length||1);
    // On pénalise si trop peu de chiffres (<0.02) car les bons contiennent références & montants
    const structural = 0.6 * (words.length / 400) + 0.4 * (digitDensity/0.1);
    const normStructural = Math.max(0, Math.min(1, structural));
    return (avgConf||0)*0.55 + normStructural*0.45;
  }

  /** Fusion naïve: concatener textes filtrés & dédoublonner lignes */
  mergeVariantTexts(texts){
    // Nouvelle fusion: vote caractère sur tokens critiques (références & code privilège)
    const lineSet = new Set();
    texts.forEach(t => t.split(/\n|\r/).forEach(l=>{ const s=l.trim(); if(s.length>3) lineSet.add(s); }));
    let merged = Array.from(lineSet).join('\n');
    merged = this.normalizeCommonOCRConfusions(merged);
    merged = this.voteCriticalTokens(texts);
    return merged;
  }

  /** Vote multi-variantes sur tokens critiques (références 3+3/4 digits & code privilège 4 chars) */
  voteCriticalTokens(texts){
    const refRegex = /\b\d{3}[.,]\d{3,4}\b/g;
    const codeRegex = /\b4G[A-Z0-9]{2}\b/gi; // base récurrente
    const allTokens = { refs: new Map(), codes: new Map() };
    texts.forEach(t => {
      const norm = t.replace(/,/g,'.');
      const refs = norm.match(refRegex)||[];
      refs.forEach(r => { const k=r.toUpperCase(); allTokens.refs.set(k,(allTokens.refs.get(k)||0)+1); });
      const codes = norm.match(codeRegex)||[];
      codes.forEach(c => { const k=c.toUpperCase(); allTokens.codes.set(k,(allTokens.codes.get(k)||0)+1); });
    });
    // Sélection des meilleurs (votes >=2 ou max)
    const pickTop = map => {
      if(!map.size) return [];
      let max=0; map.forEach(v=>{ if(v>max) max=v; });
      return Array.from(map.entries()).filter(([k,v])=> v===max || v>=2).map(([k])=>k);
    };
    const bestRefs = pickTop(allTokens.refs);
    const bestCodes = pickTop(allTokens.codes).map(c=> this.correctCodePrivilege(c));
    // Injecter en en-tête debug (optionnel) ou juste retourner texte enrichi
    const header = [];
    if(bestCodes.length) header.push('CODES:'+bestCodes.join(','));
    if(bestRefs.length) header.push('REFERENCES:'+bestRefs.join(','));
    return header.join('\n') + '\n' + texts[0];
  }

  /** Correction spécifique code privilège après vote (ex: 4GGZ -> 4G8Z) */
  correctCodePrivilege(raw){
    if(!raw) return raw;
    let cp = raw.toUpperCase();
    // Remplacements contextuels
    // Si double G mais ensuite C ou Z attendu souvent -> garder C si présent dans autres variantes
    cp = cp.replace(/GG([A-Z])$/, (m, p1) => p1==='C' ? 'GC'+p1 : 'G8'+p1); // ex 4GGCZ -> 4GCZ, 4GGZ? -> 4G8Z
    // Confusions 6/G/8 dans position 3
    if(/^4G6[A-Z0-9]$/.test(cp)) cp = cp.replace('6','8');
    if(/^4G0[A-Z0-9]$/.test(cp)) cp = cp.replace('0','8');
    // S'assurer mix lettre+chiffre
    if(!/[A-Z]/.test(cp) || !/\d/.test(cp)) return raw;
    return cp;
  }

  /** Normalise confusions fréquentes (O↔0, I↔1, S↔5, B↔8, etc.) sur segments numériques */
  normalizeCommonOCRConfusions(text){
    return text.replace(/([A-Z0-9]{3,})/g, token => {
      let t = token;
      // Appliquer seulement si le token contient au moins 2 chiffres -> probable référence
      const digitCount = (t.match(/\d/g)||[]).length;
      if (digitCount>=2){
        t = t.replace(/O/g,'0').replace(/I/g,'1').replace(/L/g,'1').replace(/S/g,'5').replace(/B/g,'8').replace(/Z/g,'2');
      }
      return t;
    });
  }

  /**
   * Recherche patterns (inchangé)
   */
  findPatterns(text, patterns = []) {
    const results = [];
    const defaultPatterns = [
      /[A-Z]{2,4}[-_]?[0-9]{3,6}[A-Z]?/g,
      /\b\d{6,10}\b/g,
      /[A-Z]\d{2,4}[A-Z]\d{2,4}/g,
      /REF[:\s]*([A-Z0-9\-_]+)/gi,
      /CODE[:\s]*([A-Z0-9\-_]+)/gi,
      /ART[:\s]*([A-Z0-9\-_]+)/gi
    ];
    const all = [...defaultPatterns, ...patterns];
    all.forEach(p => { const m = text.match(p); if (m) results.push({ pattern: p.toString(), matches: m, count: m.length }); });
    return results;
  }

  cleanText(text) {
    return text.replace(/\s+/g,' ').replace(/[^\w\s\-_.:,;]/g,'').trim();
  }
}

export default OCRService;