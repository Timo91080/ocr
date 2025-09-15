import fs from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';

class AdvancedOcrService {
  constructor() {
    this.baseUrl = process.env.ADV_OCR_URL || 'http://localhost:8001';
    this.timeout = parseInt(process.env.ADV_OCR_TIMEOUT_MS || '60000');
    this.enabled = process.env.OCR_PROVIDER === 'hybrid';
  }

  async extractText(imagePath) {
    if (!this.enabled) throw new Error('Advanced OCR désactivé (OCR_PROVIDER != hybrid)');
    const url = this.baseUrl.replace(/\/$/,'') + '/ocr';
    const form = new FormData();
    form.append('image', fs.createReadStream(imagePath));
    const controller = new AbortController();
    const to = setTimeout(()=>controller.abort(), this.timeout);
    try {
      const res = await fetch(url, { method: 'POST', body: form, signal: controller.signal });
      if (!res.ok) throw new Error('HTTP '+res.status);
      const json = await res.json();
      if (!json.success) throw new Error('Réponse microservice invalide');
      const lines = (json.text || '').split(/\n/).map(t=>t.trim()).filter(Boolean).map(l=>({ text: l, confidence: 0.6 }));
      return {
        text: json.text || '',
        confidence: 70, // placeholder (microservice ne renvoie pas un score global fiable pour l'instant)
        words: lines,
        lines,
        engine: 'hybrid_doctr_trocr',
        debug: {
          meta: json.meta,
          blocks: json.blocks?.length,
          provider: 'hybrid'
        }
      };
    } catch (e) {
      throw e;
    } finally {
      clearTimeout(to);
    }
  }
}

export default AdvancedOcrService;