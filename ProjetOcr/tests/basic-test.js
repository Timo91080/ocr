import ExtractionService from '../src/services/extractionService.js';
import path from 'path';

/**
 * Test simple du système d'extraction
 */
async function testExtraction() {
  console.log('🧪 Test du système d\'extraction OCR + LLM\n');
  
  try {
    const extractionService = new ExtractionService();
    
    console.log('✅ Service d\'extraction initialisé');
    console.log(`📝 Références connues chargées: ${extractionService.knownReferences.length}`);
    
    // Test de la validation des références
    console.log('\n🔍 Test de validation des références:');
    const testReferences = ['REF001', 'PROD-123', 'ART999', 'INVALID-REF'];
    
    const validated = extractionService.llmService.validateReferences(
      testReferences, 
      extractionService.knownReferences
    );
    
    console.log('Références valides:', validated.valid);
    console.log('Références incertaines:', validated.uncertain);
    console.log('Références invalides:', validated.invalid);
    
    // Test de nettoyage de référence
    console.log('\n🧹 Test de nettoyage des références:');
    const dirtyRefs = ['  ref-001  ', 'PROD 123!', 'art@456#'];
    dirtyRefs.forEach(ref => {
      const cleaned = extractionService.llmService.cleanReference(ref);
      console.log(`"${ref}" → "${cleaned}"`);
    });
    
    console.log('\n✅ Tests basiques réussis !');
    console.log('\n📋 Pour tester avec une vraie image:');
    console.log('1. Démarrez le serveur: npm run dev');
    console.log('2. Uploadez une image via POST /extract');
    console.log('3. Ou utilisez curl:');
    console.log('   curl -X POST -F "image=@votre-image.jpg" http://localhost:3000/extract');
    
  } catch (error) {
    console.error('❌ Erreur durant les tests:', error);
  }
}

// Exécuter les tests
testExtraction();