@@ .. @@
 import { getGoogleSheetsService } from './services/googleSheetsService.js';
 import { getMySQLStorageService } from './services/mysqlStorageService.js';
 import ExcelJS from 'exceljs';
 import fs from 'fs';
 import fetch from 'node-fetch';

 // Configuration pour ES modules
@@ .. @@
 // Route pour vérifier le statut des services AI
 app.get('/ai-status', async (req, res) => {
   try {
-    const smartLLM = extractionService.llmService;
-    const status = await smartLLM.getServicesStatus();
+    const llmStatus = extractionService.llmService.isAvailable ? 
+      { groq: { available: extractionService.llmService.isAvailable(), description: 'IA rapide gratuite' } } :
+      { groq: { available: false, description: 'IA rapide gratuite' } };
+    
+    const referenceApiStats = extractionService.referenceApiService.getStats();
     
     res.json({
       success: true,
-      services: status,
-      currentService: smartLLM.currentService ? 'Initialisé' : 'Non sélectionné',
+      services: {
+        llm: llmStatus,
+        referenceApi: referenceApiStats
+      },
       timestamp: new Date().toISOString()
     });
   } catch (error) {
@@ -1,6 +1,18 @@
+// Route pour obtenir les statistiques de l'API de référence
+app.get('/reference-api/status', (req, res) => {
+  try {
+    const stats = extractionService.referenceApiService.getStats();
+    res.json({
+      success: true,
+      ...stats,
+      timestamp: new Date().toISOString()
+    });
+  } catch (error) {
+    res.status(500).json({
+      success: false,
+      error: error.message
+    });
+  }
+});
+
+// Route pour recharger les références depuis le fichier JSON
+app.post('/reference-api/reload', async (req, res) => {
+  try {
+    await extractionService.referenceApiService.loadLocalReferences();
+    const stats = extractionService.referenceApiService.getStats();
+    res.json({
+      success: true,
+      message: 'Références rechargées avec succès',
+      ...stats
+    });
+  } catch (error) {
+    res.status(500).json({
+      success: false,
+      error: error.message
+    });
+  }
+});
+
 // Route pour l'upload et traitement d'image
 app.post('/extract', upload.single('image'), async (req, res) => {
   try {
@@ .. @@
       extraction: {
         data: result.output.extractedData,
         quality: {
           overallConfidence: result.output.quality.overallConfidence,
           ocrConfidence: result.output.quality.ocrConfidence,
           llmConfidence: result.output.quality.llmConfidence,
           textQuality: result.output.quality.textQuality.quality,
           method: result.output.quality.method
         },
+        corrections: result.output.metadata.corrections ? {
+          applied: result.output.metadata.corrections.correctionCount || 0,
+          details: result.output.metadata.corrections.corrections || []
+        } : null,
         performance: {
           totalDuration: result.performance.totalDuration,
           steps: result.performance.steps
         }
       },