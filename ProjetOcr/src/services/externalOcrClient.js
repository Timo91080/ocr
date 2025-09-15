import fetch from 'node-fetch';
import { Buffer } from 'node:buffer';

function buildExternalOcrUrl() {
  const base = process.env.EXTERNAL_OCR_URL || 'http://www.ocrwebservice.com/restservices/processDocument';
  const params = new URLSearchParams();
  params.set('gettext', 'true');
  if (process.env.EXTERNAL_OCR_LANG) params.set('language', process.env.EXTERNAL_OCR_LANG);
  if (process.env.EXTERNAL_OCR_NEWLINE) params.set('newline', process.env.EXTERNAL_OCR_NEWLINE);
  if (process.env.EXTERNAL_OCR_GETWORDS === '1') params.set('getwords', 'true');
  return `${base}?${params.toString()}`;
}

export async function externalOcrBuffer(buffer, filename = 'image.jpg') {
  const user = process.env.EXTERNAL_OCR_USERNAME;
  const lic = process.env.EXTERNAL_OCR_LICENSE;
  if (!user || !lic) throw new Error('External OCR credentials missing (EXTERNAL_OCR_USERNAME / EXTERNAL_OCR_LICENSE)');
  const auth = Buffer.from(`${user}:${lic}`).toString('base64');
  const url = buildExternalOcrUrl();

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
      'Content-Type': 'application/octet-stream'
    },
    body: buffer
  });

  if (!res.ok) {
    const txt = await res.text().catch(()=> '');
    throw new Error(`External OCR HTTP ${res.status} ${txt.slice(0,200)}`);
  }

  const data = await res.json();
  if (data.ErrorMessage) {
    throw new Error(`External OCR error: ${data.ErrorMessage}`);
  }

  const zones = Array.isArray(data.OCRText) ? data.OCRText : [];
  const zone0 = zones[0] || []; // première zone, toutes les pages concat
  const pageTexts = zone0.filter(t => typeof t === 'string');
  let lines = [];
  pageTexts.forEach(txt => {
    txt.split(/\r?\n/).forEach(L => { const line = L.trim(); if (line) lines.push(line); });
  });

  // Filtrage bruit (navigation site / HTML / mots trop génériques ou blocs juridiques hors doc)
  const NAV_PAT = /^(HOME|ABOUT|KEY FEATURES|SOAP API|REST API|PLANS|FAQ|DASHBOARD|LOG OUT|PRIVACY|TERMS|CONTACT)/i;
  const HTML_PAT = /<[^>]+>/;
  const JUNK_PAT = /^(Copyright|Sample project for OCRWebService|You should specify OCR settings)/i;
  const TOO_MANY_SYMBOLS = /[{}<>\[\]|]{2,}/;
  const cleaned = [];
  for (const raw of lines) {
    if (NAV_PAT.test(raw)) continue;
    if (HTML_PAT.test(raw)) continue;
    if (JUNK_PAT.test(raw)) continue;
    if (TOO_MANY_SYMBOLS.test(raw)) continue;
    // Supprimer longues séquences d'espaces / points répétitifs
    let t = raw.replace(/\.{3,}/g,' ').replace(/\s{2,}/g,' ').trim();
    // Filtrer lignes en majuscules très courtes sans voyelles (bruit)
    if (/^[A-Z]{2,6}$/.test(t) && !/[AEIOUY]/.test(t)) continue;
    if (t) cleaned.push(t);
  }

  lines = cleaned;

  const wrappedLines = lines.map(t => ({ text: t, confidence: 0.85, box: null }));
  const avgConfidence = wrappedLines.length ? wrappedLines.reduce((a,b)=> a + (b.confidence||0), 0) / wrappedLines.length : 0;
  return {
    engine: 'external',
    avgConfidence,
    lineCount: wrappedLines.length,
    lines: wrappedLines,
    provider: 'ocrwebservice',
    providerMeta: {
      availablePages: data.AvailablePages,
      processedPages: data.ProcessedPages
    }
  };
}

export default { externalOcrBuffer };
