import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

/**
 * OCR.space client
 * API docs: https://ocr.space/ocrapi
 * We send multipart form-data with API key header.
 */
export async function ocrSpaceRecognize(imagePath) {
  const apiKey = process.env.OCRSPACE_API_KEY;
  if (!apiKey) throw new Error('OCRSPACE_API_KEY manquant');
  const endpoint = process.env.OCRSPACE_URL || 'https://api.ocr.space/parse/image';
  const lang = process.env.OCRSPACE_LANGUAGE || 'fre'; // French
  const ocrEngine = process.env.OCRSPACE_ENGINE || '2'; // engine 2 (recommended)
  const isTable = process.env.OCRSPACE_IS_TABLE === '1';

  const form = new FormData();
  form.append('language', lang);
  form.append('OCREngine', ocrEngine);
  form.append('scale', 'true');
  form.append('isOverlayRequired', 'true');
  if (isTable) form.append('isTable', 'true');
  form.append('file', fs.createReadStream(imagePath), path.basename(imagePath));

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'apikey': apiKey },
    body: form
  });

  if (!res.ok) {
    const txt = await res.text().catch(()=> '');
    throw new Error(`OCR.space HTTP ${res.status} ${txt.slice(0,200)}`);
  }

  const data = await res.json();
  if (data.IsErroredOnProcessing) {
    throw new Error(`OCR.space error: ${(data.ErrorMessage||[]).join(', ')}`);
  }

  const parsed = data.ParsedResults || [];
  const lines = [];
  parsed.forEach(pr => {
    // ParsedText -> split lines
    if (pr.ParsedText) {
      pr.ParsedText.split(/\r?\n/).forEach(L => {
        const t = L.trim();
        if (t) lines.push({ text: t, confidence: 0.9, box: null });
      });
    }
    // Overlay Words -> attempt grouping into lines
    if (pr.TextOverlay && Array.isArray(pr.TextOverlay.Lines)) {
      pr.TextOverlay.Lines.forEach(line => {
        const txt = (line.Words||[]).map(w=>w.WordText).join(' ').trim();
        if (txt) lines.push({ text: txt, confidence: 0.92, box: line.Words.map(w=>({ left:w.Left, top:w.Top, width:w.Width, height:w.Height })) });
      });
    }
  });

  // Deduplicate lines keeping first occurrence
  const seen = new Set();
  const finalLines = [];
  for (const l of lines) {
    const key = l.text;
    if (seen.has(key)) continue;
    seen.add(key);
    finalLines.push(l);
  }

  const avgConfidence = finalLines.length ? finalLines.reduce((a,b)=>a+b.confidence,0)/finalLines.length : 0;
  return {
    engine: 'ocrspace',
    lineCount: finalLines.length,
    avgConfidence,
    lines: finalLines,
    provider: 'ocrspace'
  };
}

export default { ocrSpaceRecognize };
