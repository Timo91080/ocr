import fetch from 'node-fetch';

/**
 * Service de gestion de l'API JSON de référence
 * Permet de vérifier et corriger les données extraites
 */
class ReferenceApiService {
  constructor() {
    this.apiUrl = process.env.REFERENCE_API_URL || 'http://localhost:3000/api/references';
    this.localJsonPath = process.env.LOCAL_JSON_PATH || './data/bons-mock.json';
    this.enabled = process.env.ENABLE_REFERENCE_CORRECTION === '1';
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
    
    console.log(`🔍 ReferenceApiService ${this.enabled ? 'activé' : 'désactivé'}`);
    if (this.enabled) {
      this.loadLocalReferences();
    }
  }

  /**
   * Charge les références depuis le fichier JSON local
   */
  async loadLocalReferences() {
    try {
      const fs = await import('fs');
      const data = JSON.parse(fs.readFileSync(this.localJsonPath, 'utf8'));
      
      // Extraire tous les articles de toutes les demandes
      const allItems = [];
      data.forEach(doc => {
        if (doc.demandes) {
          doc.demandes.forEach(demande => {
            if (demande.items) {
              demande.items.forEach(item => {
                allItems.push({
                  reference: item['Codif cat'],
                  taille: item.Taille,
                  modele: item.Modèle,
                  coloris: item.coloris,
                  prix: item.PV
                });
              });
            }
          });
        }
      });

      this.localReferences = allItems;
      console.log(`✅ ${allItems.length} références chargées depuis ${this.localJsonPath}`);
      
    } catch (error) {
      console.warn('⚠️ Impossible de charger les références locales:', error.message);
      this.localReferences = [];
    }
  }

  /**
   * Recherche une référence dans la base de données
   */
  findReference(reference) {
    if (!this.localReferences) return null;
    
    return this.localReferences.find(ref => 
      ref.reference === reference || 
      ref.reference?.replace(/\s+/g, '') === reference?.replace(/\s+/g, '')
    );
  }

  /**
   * Recherche par modèle (approximative)
   */
  findByModel(modele) {
    if (!this.localReferences || !modele) return [];
    
    const modeleLower = modele.toLowerCase();
    return this.localReferences.filter(ref => 
      ref.modele?.toLowerCase().includes(modeleLower) ||
      modeleLower.includes(ref.modele?.toLowerCase())
    );
  }

  /**
   * Calcule un score de similarité entre deux chaînes
   */
  calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    
    if (s1 === s2) return 1;
    
    // Distance de Levenshtein simplifiée
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    
    if (longer.length === 0) return 1;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Calcule la distance de Levenshtein
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Corrige un article extrait en le comparant avec la base de référence
   */
  correctArticle(extractedArticle) {
    if (!this.enabled || !this.localReferences) {
      return { corrected: extractedArticle, corrections: [] };
    }

    const corrections = [];
    let corrected = { ...extractedArticle };

    // 1. Recherche par référence exacte
    if (extractedArticle.reference) {
      const exactMatch = this.findReference(extractedArticle.reference);
      if (exactMatch) {
        console.log(`🎯 Référence exacte trouvée: ${extractedArticle.reference}`);
        
        // Corriger tous les champs avec les données de référence
        if (exactMatch.modele && exactMatch.modele !== corrected.nom_produit) {
          corrections.push({
            field: 'nom_produit',
            original: corrected.nom_produit,
            corrected: exactMatch.modele,
            confidence: 1.0,
            reason: 'Référence exacte trouvée'
          });
          corrected.nom_produit = exactMatch.modele;
        }

        if (exactMatch.coloris && exactMatch.coloris !== corrected.coloris) {
          corrections.push({
            field: 'coloris',
            original: corrected.coloris,
            corrected: exactMatch.coloris,
            confidence: 1.0,
            reason: 'Référence exacte trouvée'
          });
          corrected.coloris = exactMatch.coloris;
        }

        if (exactMatch.taille && exactMatch.taille !== corrected.taille_ou_code) {
          corrections.push({
            field: 'taille_ou_code',
            original: corrected.taille_ou_code,
            corrected: exactMatch.taille,
            confidence: 1.0,
            reason: 'Référence exacte trouvée'
          });
          corrected.taille_ou_code = exactMatch.taille;
        }

        if (exactMatch.prix && Math.abs(exactMatch.prix - (corrected.prix_unitaire || 0)) > 0.01) {
          corrections.push({
            field: 'prix_unitaire',
            original: corrected.prix_unitaire,
            corrected: exactMatch.prix,
            confidence: 1.0,
            reason: 'Référence exacte trouvée'
          });
          corrected.prix_unitaire = exactMatch.prix;
          corrected.total_ligne = exactMatch.prix * (corrected.quantite || 1);
        }

        return { corrected, corrections };
      }
    }

    // 2. Recherche approximative par modèle
    if (extractedArticle.nom_produit) {
      const modelMatches = this.findByModel(extractedArticle.nom_produit);
      
      if (modelMatches.length > 0) {
        // Trouver la meilleure correspondance
        let bestMatch = null;
        let bestScore = 0;

        for (const match of modelMatches) {
          const score = this.calculateSimilarity(extractedArticle.nom_produit, match.modele);
          if (score > bestScore && score > 0.7) { // Seuil de 70%
            bestScore = score;
            bestMatch = match;
          }
        }

        if (bestMatch) {
          console.log(`🔍 Correspondance approximative trouvée: ${bestMatch.modele} (score: ${bestScore.toFixed(2)})`);
          
          // Suggérer la référence si elle manque
          if (!corrected.reference && bestMatch.reference) {
            corrections.push({
              field: 'reference',
              original: corrected.reference,
              corrected: bestMatch.reference,
              confidence: bestScore,
              reason: `Correspondance modèle (${(bestScore * 100).toFixed(0)}%)`
            });
            corrected.reference = bestMatch.reference;
          }

          // Corriger le prix si très différent
          if (bestMatch.prix && Math.abs(bestMatch.prix - (corrected.prix_unitaire || 0)) > 5) {
            corrections.push({
              field: 'prix_unitaire',
              original: corrected.prix_unitaire,
              corrected: bestMatch.prix,
              confidence: bestScore,
              reason: `Correspondance modèle (${(bestScore * 100).toFixed(0)}%)`
            });
            corrected.prix_unitaire = bestMatch.prix;
            corrected.total_ligne = bestMatch.prix * (corrected.quantite || 1);
          }
        }
      }
    }

    return { corrected, corrections };
  }

  /**
   * Corrige tous les articles d'une extraction
   */
  correctExtraction(extraction) {
    if (!this.enabled || !extraction.articles) {
      return { corrected: extraction, allCorrections: [] };
    }

    const corrected = { ...extraction };
    const allCorrections = [];

    corrected.articles = extraction.articles.map((article, index) => {
      const { corrected: correctedArticle, corrections } = this.correctArticle(article);
      
      if (corrections.length > 0) {
        console.log(`✏️ Article ${index + 1}: ${corrections.length} correction(s) appliquée(s)`);
        corrections.forEach(corr => {
          allCorrections.push({
            articleIndex: index,
            ...corr
          });
        });
      }

      return correctedArticle;
    });

    // Recalculer les totaux après corrections
    if (corrected.articles.length > 0) {
      const newSubTotal = corrected.articles.reduce((sum, article) => {
        return sum + (article.total_ligne || article.prix_unitaire || 0);
      }, 0);

      if (corrected.totaux) {
        corrected.totaux.sous_total_articles = Number(newSubTotal.toFixed(2));
        
        // Recalculer le total avec frais si nécessaire
        if (corrected.totaux.participation_frais_livraison) {
          corrected.totaux.total_avec_frais = Number(
            (newSubTotal + corrected.totaux.participation_frais_livraison).toFixed(2)
          );
        }
      }
    }

    return { corrected, allCorrections };
  }

  /**
   * Obtient les statistiques de la base de référence
   */
  getStats() {
    return {
      enabled: this.enabled,
      totalReferences: this.localReferences?.length || 0,
      cacheSize: this.cache.size,
      apiUrl: this.apiUrl,
      localJsonPath: this.localJsonPath
    };
  }
}

export default ReferenceApiService;