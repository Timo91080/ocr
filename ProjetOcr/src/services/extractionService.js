import OCRService from './ocrService.js';
import GroqLLMService from './groqLLMService.js';
import ImageProcessor from '../utils/imageProcessor.js';
import path from 'path';
import { buildAdvancedStructure, extractPriorityFields } from './advancedExtraction.js';
import { disambiguateStructuredFields } from '../utils/charDisambiguator.js';
import { generateTextReport } from '../utils/textReportFormatter.js';

/**
 * Service principal d'extraction qui orchestre le pipeline complet:
 * Image → Preprocessing → OCR → LLM → Validation → Résultats
 */
class ExtractionService {
  constructor() {
    console.log('🔀 OCR provider fixé: ocrspace (mode simplifié)');
    this.ocrService = new OCRService();
    
    // Utilisation unique de Groq (simplification demandée)
    if (!process.env.GROQ_API_KEY) {
      console.warn('⚠️ GROQ_API_KEY manquant – les appels LLM échoueront. Ajoutez la clé dans .env');
    }
    console.log('🚀 Mode Groq unique activé (tous les autres LLM retirés)');
    this.llmService = new GroqLLMService();
    
    this.imageProcessor = new ImageProcessor();
  }

  /**
   * Pipeline complet d'extraction des références
   * @param {string} imagePath - Chemin vers l'image du bon de commande
   * @param {Object} options - Options de traitement
   * @returns {Promise<Object>} Résultats complets de l'extraction
   */
  async extractReferences(imagePath, options = {}) {
    const startTime = Date.now();
    console.log(`🚀 Début du pipeline d'extraction pour: ${imagePath}`);
    
    try {
      const result = {
        input: {
          imagePath: imagePath,
          options: options,
          timestamp: new Date().toISOString()
        },
        steps: {},
        output: {},
        performance: {}
      };

      // Étape 1: Préprocessing de l'image
      console.log('📸 Étape 1: Préprocessing de l\'image...');
      const stepStart = Date.now();
      
      const imageProcessingResult = await this.imageProcessor.processImageComplete(imagePath, {
        preprocess: options.preprocess !== false,
        orientation: options.orientation !== false,
        threshold: options.threshold || false,
        thresholdValue: options.thresholdValue || 128,
        ...options.imageProcessing
      });
      
      result.steps.imageProcessing = {
        ...imageProcessingResult,
        duration: Date.now() - stepStart
      };
      
      console.log(`✅ Preprocessing terminé en ${result.steps.imageProcessing.duration}ms`);

      // Étape 2: Extraction OCR
      console.log('🔍 Étape 2: Extraction OCR...');
      const ocrStart = Date.now();
      
      let ocrResult = await this.ocrService.extractText(
        imageProcessingResult.processedPath,
        options.ocr || {}
      );
      let fallbackUsed = false; // plus utilisé mais gardé dans metadata pour compat compat
      
      result.steps.ocr = {
        ...ocrResult,
        duration: Date.now() - ocrStart,
        fallbackUsed
      };
      
      console.log(`✅ OCR terminé en ${result.steps.ocr.duration}ms - Confiance: ${ocrResult.confidence}%`);

      // Étape 3: Analyse LLM
      console.log('🤖 Étape 3: Analyse LLM...');
      const llmStart = Date.now();
      
      const llmResult = await this.llmService.extractStructuredInfo(ocrResult.text);
      
      result.steps.llm = {
        ...llmResult,
        duration: Date.now() - llmStart
      };
      
      console.log(`✅ LLM terminé en ${result.steps.llm.duration}ms - Confiance: ${llmResult.confidence}`);

      // Étape 4: Compilation des résultats finaux
      console.log('📋 Étape 4: Compilation des résultats...');
      
      result.output = this.compileResults(result.steps);
      // Ajouter rapport texte lisible (style ancien) pour inspection
      try {
        result.output.textReport = generateTextReport(result.output.extractedData);
      } catch(e){ if (process.env.OCR_DEBUG==='1') console.warn('Text report fail:', e.message); }
      // Post-fix code privilège si manquant (OCR direct)
      try {
        const client = result.output?.extractedData?.client || {};
        if (!client.code_privilege) {
          const cp = this.extractCodePrivilegeFallback(ocrResult.text);
          if (cp) {
            client.code_privilege = cp;
            if (process.env.OCR_DEBUG === '1') console.log('🔧 Code privilège ajouté (fallback OCR):', cp);
          }
        } else {
          // Corriger cas 4GGZ -> 4G8Z etc. si présent
          const fixed = this.normalizeCodePrivilege(client.code_privilege);
          if (fixed !== client.code_privilege) {
            if (process.env.OCR_DEBUG==='1') console.log('🩹 Correction code privilège:', client.code_privilege,'->',fixed);
            client.code_privilege = fixed;
          }
        }
      } catch(e){ if (process.env.OCR_DEBUG === '1') console.warn('Fallback code privilège erreur:', e.message); }
      result.output.metadata = {
        ...(result.output.metadata||{}),
        fallbackUsed: result.steps.ocr.fallbackUsed
      };
      result.performance = {
        totalDuration: Date.now() - startTime,
        steps: Object.keys(result.steps).reduce((acc, step) => {
          acc[step] = result.steps[step].duration || 0;
          return acc;
        }, {})
      };

      console.log(`🎉 Pipeline terminé avec succès en ${result.performance.totalDuration}ms`);
      console.log(`📊 Résultats: extraction réussie avec confiance ${result.output.extractedData.confidence}`);
      
      return result;
      
    } catch (error) {
      console.error('❌ Erreur dans le pipeline d\'extraction:', error);
      throw new Error(`Erreur pipeline: ${error.message}`);
    }
  }

  /**
   * Compile les résultats de toutes les étapes
   * @param {Object} steps - Résultats de chaque étape
   * @returns {Object} Résultats finaux compilés
   */
  compileResults(steps) {
    const { ocr, llm } = steps;
    const ocrText = ocr.text || '';
    const heuristics = extractPriorityFields(ocrText);
    // Fusion logique: LLM prioritaire, heuristique comble null/vides
    const fusion = {
      client: { ...heuristics.client, ...(llm.client || {}) },
      livraison: { ...heuristics.livraison, ...(llm.livraison || {}) },
      articles: (llm.articles && llm.articles.length ? llm.articles : heuristics.articles) || [],
      totaux: { ...heuristics.totaux, ...(llm.totaux || {}) },
      confidence: llm.confidence || 0.9,
      method: llm.method || 'groq_llama4'
    };

    // Heuristique: tentative de récupération des numéros de page manquants
    try {
      if (fusion.articles.length) {
        const missingPageCount = fusion.articles.filter(a => !a.page_catalogue).length;
        if (missingPageCount) {
          const pageCandidates = this.guessPageNumbersFromOCR(ocrText, fusion.articles.length);
          if (pageCandidates.length) {
            let idx = 0;
            fusion.articles.forEach(a => {
              if (!a.page_catalogue && pageCandidates[idx] != null) {
                a.page_catalogue = pageCandidates[idx];
                idx++;
              }
            });
            if (process.env.OCR_DEBUG === '1') {
              console.log('🧩 Pages ajoutées heuristiquement:', fusion.articles.map(a=>a.page_catalogue));
            }
          }
        }
      }
    } catch (e) {
      if (process.env.OCR_DEBUG === '1') console.warn('Heuristique pages échouée:', e.message);
    }
    // Recalcul champs dérivés totaux si manquants
    if (fusion.articles.length && (fusion.totaux.sous_total_articles == null)) {
      const sum = fusion.articles.reduce((a,c)=> a + (c.total_ligne || c.prix_unitaire || 0),0);
      fusion.totaux.sous_total_articles = Number(sum.toFixed(2));
    }
    // normaliser devise
    if (!fusion.totaux.devise && (fusion.totaux.total_commande != null || fusion.articles.length)) fusion.totaux.devise = 'EUR';

    // Score heuristique simple
    const heuristicScore = (
      (fusion.client.nom_complet ? 0.25:0) +
      (fusion.client.numero_client ? 0.15:0) +
      (fusion.articles.length ? 0.30:0) +
      (fusion.totaux.total_commande != null ? 0.30:0)
    );
    const quality = {
      ocrConfidence: ocr.confidence || 0,
      llmConfidence: fusion.confidence || 0,
      heuristicCoverage: heuristicScore,
      overallConfidence: this.calculateOverallConfidence(ocr.confidence, (fusion.confidence || 0), heuristicScore),
      textQuality: this.assessTextQuality(ocr.text),
      method: fusion.method
    };
    // Désambiguïsation optionnelle (lettres/chiffres confondus)
    let disambigInfo = null;
    try {
      const { corrected, changes } = disambiguateStructuredFields(fusion);
      fusion = corrected; // appliquer corrections
      if (changes.length) disambigInfo = { count: changes.length, changes };
    } catch (e) {
      if (process.env.OCR_DEBUG === '1') console.warn('⚠️ Disambiguation failed:', e.message);
    }
    return {
      extractedData: fusion,
      quality,
      metadata: {
        ocrText: ocrText,
        processedImagePath: steps.imageProcessing?.processedPath,
        llmMethod: fusion.method,
        processingTime: steps.llm?.duration,
        disambiguation: disambigInfo
      }
    };
  }

  /**
   * Devine une liste ordonnée de numéros de pages à partir du texte OCR.
   * Stratégie: repérer les lignes qui commencent par 1-3 chiffres suivis d'un espace
   * et d'un mot (maj/min). Élimine les doublons, retourne au plus articleCount éléments.
   */
  guessPageNumbersFromOCR(ocrText, articleCount) {
    const lines = ocrText.split(/\r?\n/);
    const pages = [];
    const seen = new Set();
    const headerRegex = /PAGE\s+NOM\s+DU\s+MODÈLE/i;
    for (let raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (headerRegex.test(line)) continue; // ignorer l'en-tête
      // Chercher un motif début de ligne: nombre (1-3 chiffres) + espace + lettres (>=2)
      const m = line.match(/^([0-9]{1,3})\s+([A-ZÀÂÄÉÈËÎÏÔÖÙÛÜa-z]{2,})/);
      if (m) {
        const pageNum = m[1];
        // Filtrer pages improbables (0 ou > 999 déjà éliminé) & éviter colonnes de totaux
        if (!seen.has(pageNum)) {
          // Exclure si le mot suivant ressemble à '€' ou 'TOTAL'
          const nextToken = m[2].toUpperCase();
            if (nextToken !== 'TOTAL') {
              pages.push(pageNum);
              seen.add(pageNum);
              if (pages.length >= articleCount) break;
            }
        }
      }
    }
    return pages;
  }

  /**
   * Calcule un score de confiance global
   * @param {number} ocrConfidence - Confiance OCR (0-100)
   * @param {number} llmConfidence - Confiance LLM (0-1)
   * @returns {number} Confiance globale (0-1)
   */
  calculateOverallConfidence(ocrConfidence, llmConfidence, heuristicScore = 0) {
    const normalizedOcr = (ocrConfidence || 0) / 100; // 0-1
    const normalizedLlm = llmConfidence || 0; // 0-1
    const h = heuristicScore; // déjà 0-1
    // Pondération: OCR 30%, LLM 45%, heuristiques 25%
    return (normalizedOcr * 0.30) + (normalizedLlm * 0.45) + (h * 0.25);
  }

  /**
   * Évalue la qualité du texte OCR
   * @param {string} text - Texte extrait
   * @returns {Object} Métriques de qualité
   */
  assessTextQuality(text) {
    const length = text.length;
    const wordCount = text.split(/\s+/).length;
    const lineCount = text.split('\n').length;
    const specialChars = (text.match(/[^a-zA-Z0-9\s]/g) || []).length;
    
    return {
      textLength: length,
      wordCount: wordCount,
      lineCount: lineCount,
      specialCharRatio: specialChars / length,
      averageWordLength: length / wordCount,
      quality: length > 50 && specialChars / length < 0.3 ? 'good' : 'poor'
    };
  }

  /** Fallback extraction code privilège dans le texte OCR brut */
  extractCodePrivilegeFallback(text='') {
    if (!text) return null;
    // Chercher libellé explicite
  let m = text.match(/CODE\s+PRIVIL[ÈE]G[ÈE]?\s*[:\-]?\s*([A-Z0-9]{3,6})/i);
    if (m) return this.normalizeCodePrivilege(m[1]);
    // Motifs courts style 4G8M / 3M8J / 4AM9 (lettre+chiffres 3-5)
  const cand = text.match(/\b[0-9][A-Z0-9]{2,3}\b/g);
    if (cand) {
      for (const c of cand) {
        const norm = this.normalizeCodePrivilege(c);
        if (norm && /\d/.test(norm) && /[A-Z]/.test(norm) && norm.length<=6) return norm;
      }
    }
    return null;
  }

  normalizeCodePrivilege(raw) {
    if (!raw) return null;
    let cp = raw.toUpperCase().replace(/\s+/g,'');
    cp = cp
      .replace(/O/g,'0')
      .replace(/I/g,'1')
      .replace(/B/g,'8')
      .replace(/6/g,'G');
  if (/^40/.test(cp)) cp = '4G' + cp.slice(2);
  if (cp.length > 4) cp = cp.slice(0,4);
  // Validation stricte: 3-4 chars, au moins 1 lettre et 1 chiffre
  if (cp.length < 3 || cp.length > 4) return null;
    if (!/[A-Z]/.test(cp) || !/\d/.test(cp)) return null;
    // Rejeter si 3 chiffres + 3 chiffres (référence) ou >=4 chiffres total
    const digitCount = (cp.match(/\d/g)||[]).length;
  if (digitCount >= 4) return null;
    // Rejeter séquences purement numériques déguisées (ex: 443501) traitées ci-dessus
    return cp;
  }

  /**
   * Génère des recommandations d'amélioration
   * @param {Object} quality - Métriques de qualité
   * @param {Object} context - Contexte du document
   * @returns {Array} Liste de recommandations
   */
  generateRecommendations(quality, context) {
    const recommendations = [];
    
    if (quality.ocrConfidence < 70) {
      recommendations.push({
        type: 'image_quality',
        message: 'Qualité OCR faible. Essayez d\'améliorer la qualité de l\'image (résolution, contraste).',
        priority: 'high'
      });
    }
    
    if (quality.llmConfidence < 0.6) {
      recommendations.push({
        type: 'text_clarity',
        message: 'Confiance LLM faible. Le texte pourrait être ambigu ou contenir peu de références.',
        priority: 'medium'
      });
    }
    
    if (quality.textQuality.quality === 'poor') {
      recommendations.push({
        type: 'preprocessing',
        message: 'Qualité de texte faible. Essayez le préprocessing avancé ou recadrez le document.',
        priority: 'medium'
      });
    }
    
    if (context?.suggestions) {
      context.suggestions.forEach(suggestion => {
        recommendations.push({
          type: 'llm_suggestion',
          message: suggestion,
          priority: 'low'
        });
      });
    }
    
    return recommendations;
  }

  /**
   * Charge la base de références connues
   * TODO: Remplacer par une vraie base de données
   * @returns {Array} Liste des références connues
   */
  loadKnownReferences() {
    // Base de données factice pour les tests
    return [
      'REF001', 'REF002', 'REF003',
      'PROD-123', 'PROD-456', 'PROD-789',
      'ART001A', 'ART002B', 'ART003C',
      'ABC123DEF', 'XYZ789GHI',
      '123456789', '987654321',
      'SKU-001', 'SKU-002', 'SKU-003'
    ];
  }

  /**
   * Met à jour la base de références connues
   * @param {Array} newReferences - Nouvelles références à ajouter
   */
  updateKnownReferences(newReferences) {
    this.knownReferences = [...new Set([...this.knownReferences, ...newReferences])];
    console.log(`📝 Base de références mise à jour: ${this.knownReferences.length} références`);
  }

  /**
   * Traitement par lots de plusieurs images
   * @param {Array} imagePaths - Liste des chemins d'images
   * @param {Object} options - Options communes
   * @returns {Promise<Array>} Résultats pour chaque image
   */
  async batchExtraction(imagePaths, options = {}) {
    console.log(`📦 Traitement par lots: ${imagePaths.length} images`);
    
    const results = [];
    
    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i];
      console.log(`\n🔄 Traitement ${i + 1}/${imagePaths.length}: ${path.basename(imagePath)}`);
      
      try {
        const result = await this.extractReferences(imagePath, options);
        result.batchInfo = {
          index: i + 1,
          total: imagePaths.length,
          filename: path.basename(imagePath)
        };
        results.push(result);
      } catch (error) {
        console.error(`❌ Erreur pour ${imagePath}:`, error.message);
        results.push({
          error: error.message,
          imagePath: imagePath,
          batchInfo: {
            index: i + 1,
            total: imagePaths.length,
            filename: path.basename(imagePath)
          }
        });
      }
    }
    
    console.log(`\n🎉 Traitement par lots terminé: ${results.length} résultats`);
    return results;
  }
}

export default ExtractionService;