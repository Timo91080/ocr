@@ .. @@
 import { buildAdvancedStructure, extractPriorityFields } from './advancedExtraction.js';
 import { disambiguateStructuredFields } from '../utils/charDisambiguator.js';
 import { generateTextReport } from '../utils/textReportFormatter.js';
+import ReferenceApiService from './referenceApiService.js';

 /**
  * Service principal d'extraction qui orchestre le pipeline complet:
@@ .. @@
     this.llmService = new GroqLLMService();
     
     this.imageProcessor = new ImageProcessor();
+    
+    // Initialiser le service de correction avec API de référence
+    this.referenceApiService = new ReferenceApiService();
   }

   /**
@@ .. @@
       console.log(`✅ LLM terminé en ${result.steps.llm.duration}ms - Confiance: ${llmResult.confidence}`);

-      // Étape 4: Compilation des résultats finaux
-      console.log('📋 Étape 4: Compilation des résultats...');
+      // Étape 4: Correction avec API de référence
+      console.log('🔧 Étape 4: Correction avec API de référence...');
+      const correctionStart = Date.now();
+      
+      // Compiler d'abord les résultats
+      const preliminaryOutput = this.compileResults(result.steps);
+      
+      // Appliquer les corrections
+      const { corrected: correctedExtraction, allCorrections } = this.referenceApiService.correctExtraction(preliminaryOutput.extractedData);
+      
+      result.steps.correction = {
+        corrections: allCorrections,
+        correctionCount: allCorrections.length,
+        duration: Date.now() - correctionStart
+      };
+      
+      console.log(`✅ Correction terminée en ${result.steps.correction.duration}ms - ${allCorrections.length} correction(s) appliquée(s)`);
+
+      // Étape 5: Compilation des résultats finaux
+      console.log('📋 Étape 5: Compilation des résultats finaux...');
       
-      result.output = this.compileResults(result.steps);
+      result.output = this.compileResults(result.steps, correctedExtraction);
       // Ajouter rapport texte lisible (style ancien) pour inspection
       try {
         result.output.textReport = generateTextReport(result.output.extractedData);
@@ .. @@
   /**
    * Compile les résultats de toutes les étapes
    * @param {Object} steps - Résultats de chaque étape
+   * @param {Object} correctedExtraction - Données corrigées (optionnel)
    * @returns {Object} Résultats finaux compilés
    */
-  compileResults(steps) {
+  compileResults(steps, correctedExtraction = null) {
     const { ocr, llm } = steps;
     const ocrText = ocr.text || '';
-    const heuristics = extractPriorityFields(ocrText);
-    // Fusion logique: LLM prioritaire, heuristique comble null/vides
-    const fusion = {
-      client: { ...heuristics.client, ...(llm.client || {}) },
-      livraison: { ...heuristics.livraison, ...(llm.livraison || {}) },
-      articles: (llm.articles && llm.articles.length ? llm.articles : heuristics.articles) || [],
-      totaux: { ...heuristics.totaux, ...(llm.totaux || {}) },
-      confidence: llm.confidence || 0.9,
-      method: llm.method || 'groq_llama4'
-    };
+    
+    let fusion;
+    if (correctedExtraction) {
+      // Utiliser les données corrigées
+      fusion = {
+        ...correctedExtraction,
+        confidence: llm.confidence || 0.9,
+        method: (llm.method || 'groq_llama4') + '_corrected'
+      };
+    } else {
+      // Fusion logique originale: LLM prioritaire, heuristique comble null/vides
+      const heuristics = extractPriorityFields(ocrText);
+      fusion = {
+        client: { ...heuristics.client, ...(llm.client || {}) },
+        livraison: { ...heuristics.livraison, ...(llm.livraison || {}) },
+        articles: (llm.articles && llm.articles.length ? llm.articles : heuristics.articles) || [],
+        totaux: { ...heuristics.totaux, ...(llm.totaux || {}) },
+        confidence: llm.confidence || 0.9,
+        method: llm.method || 'groq_llama4'
+      };
+    }

     // Heuristique: tentative de récupération des numéros de page manquants
@@ .. @@
       metadata: {
         ocrText: ocrText,
         processedImagePath: steps.imageProcessing?.processedPath,
         llmMethod: fusion.method,
         processingTime: steps.llm?.duration,
-        disambiguation: disambigInfo
+        disambiguation: disambigInfo,
+        corrections: steps.correction || null
       }
     };
   }