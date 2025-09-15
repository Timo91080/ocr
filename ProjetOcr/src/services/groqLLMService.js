import Groq from 'groq-sdk';

/**
 * Service LLM utilisant Groq (gratuit, très rapide)
 * Alternative excellente à Hugging Face
 */
class GroqLLMService {
  constructor() {
    try {
      console.log('🔧 Initialisation GroqLLMService...');
      
      if (!process.env.GROQ_API_KEY) {
        throw new Error('Clé API Groq manquante dans les variables d\'environnement');
      }
      
      console.log('🔑 Clé API Groq trouvée');
      
      // Ne pas initialiser le SDK immédiatement pour éviter les erreurs asynchrones
      this.groq = null;
      this.isInitialized = false;
      
      this.model = process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
      this.maxTokens = 2048;
      this.temperature = 0.1;
      
      console.log(`🚀 Groq Service avec ${this.model} (initialisation différée)`);
      console.log('✅ GroqLLMService configuré');
      
    } catch (error) {
      console.error('❌ Erreur initialisation GroqLLMService:', error.message);
      console.error('❌ Stack trace:', error.stack);
      throw error;
    }
  }

  /**
   * Initialise le SDK Groq de façon différée
   */
  async initializeGroqSDK() {
    if (this.isInitialized && this.groq) {
      return;
    }

    try {
      console.log('📦 Initialisation du SDK Groq...');
      const Groq = (await import('groq-sdk')).default;
      
      this.groq = new Groq({
        apiKey: process.env.GROQ_API_KEY
      });
      
      this.isInitialized = true;
      console.log('✅ SDK Groq initialisé');
      
    } catch (error) {
      console.error('❌ Erreur SDK Groq:', error);
      throw error;
    }
  }

  /**
   * Vérifie si Groq est configuré
   */
  isAvailable() {
    return !!process.env.GROQ_API_KEY;
  }

  /**
   * Extraction structurée avec Groq
   * @param {string} ocrText - Texte extrait par OCR
   * @returns {Promise<Object>} Informations extraites
   */
  async extractStructuredInfo(ocrText) {
    try {
      console.log('⚡ Début extraction avec Groq...');
      
      if (!this.isAvailable()) {
        throw new Error('Clé API Groq manquante');
      }

      // Initialisation différée du SDK
      await this.initializeGroqSDK();

      if (!this.groq) {
        throw new Error('Service Groq non initialisé');
      }

      const prompt = this.createOptimizedPrompt(ocrText);
      console.log('📝 Prompt créé, appel API Groq...');
      
      const response = await this.groq.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: "Tu es un expert en extraction de données de documents français. Tu extrais avec précision les informations et réponds toujours en JSON valide."
          },
          {
            role: "user", 
            content: prompt
          }
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature
      });

      console.log('✅ Réponse API Groq reçue');
      const extractedData = this.parseResponse(response.choices[0].message.content);
      console.log('🎯 Données Groq extraites:', extractedData);
      
      return extractedData;
      
    } catch (error) {
      console.error('❌ Erreur Groq complète:', error);
      console.error('❌ Stack trace:', error.stack);
      throw error;
    }
  }

  /**
   * Crée un prompt optimisé pour Groq
   */
  createOptimizedPrompt(ocrText) {
    const limitedText = ocrText.substring(0, 5500);
    return `Tu extrais STRICTEMENT le JSON correspondant au schéma ci-dessous à partir d'un bon de commande Afibel (texte OCR bruité). Ne renvoie AUCUN texte hors JSON. Jamais de commentaires.

OBJECTIF: Structurer les données manuscrites + imprimées.

SCHEMA (toutes les clés DOIVENT être présentes; mets null si inconnue):
{
  "client": {
    "nom_complet": string|null,
  "numero_client": string|null,           // max 9 caractères (couper si plus long) ex: 170610229
  "code_privilege": string|null,          // EXACTEMENT 3 ou 4 caractères mix lettres+chiffres (ex: 4G8M, 4GCZ, 4AM9, 3M8J, 4H2X)
    "telephone_portable": string|null,      // format 0X XX XX XX XX si possible
    "telephone_fixe": string|null,
    "date_naissance": string|null,          // jj/mm/aaaa ou jj mm aaaa
    "email": string|null
  },
  "livraison": {
    "livraison_domicile": "oui"|"non"|null,
    "point_relais_principal": string|null,
    "autre_point_relais": string|null
  },
  "articles": [
    {
      "page_catalogue": string|null,        // numéro de page (1-3 chiffres) si clairement présent avant la ligne
      "nom_produit": string|null,           // texte descriptif sans prix ni référence
      "coloris": string|null,               // Rose, Blanc, Noir, Bleu, Beige, etc. sinon null
      "reference": string|null,             // EXACTEMENT 6 ou 7 chiffres total sous forme 3+3 ou 3+4 (ex: 2818341 ou 281.8341). Ne pas inventer.
      "taille_ou_code": string|null,        // 1 à 4 chiffres isolés (ex: 54, 56, 641) ne pas confondre avec référence
      "quantite": number|null,              // entier >=1
      "prix_unitaire": number|null,         // nombre décimal >=0
      "total_ligne": number|null,           // nombre décimal >= prix_unitaire
      "devise": string|null                 // 'EUR' si € visible sur la ligne ou ailleurs
    }
  ],
  "totaux": {
    "sous_total_articles": number|null,
    "participation_frais_livraison": number|null,
    "total_commande": number|null,
    "total_avec_frais": number|null,
    "devise": string|null
  },
  "confidence": number
}

RÈGLES SPÉCIFIQUES:
1. Code privilège: 3 ou 4 caractères seulement, au moins 1 lettre et 1 chiffre, jamais uniquement des chiffres, ne pas confondre avec référence (6-7 chiffres) ni taille (1-4 chiffres).
2. Référence: motif 3 chiffres + séparateur éventuel (virgule ou point ou rien) + 3 ou 4 chiffres => normaliser en remplaçant virgule par point. Refuser si >7 chiffres.
3. Taille/code: 1 à 4 chiffres isolés qui NE SONT PAS la référence.
4. Prix: convertir 16,99 / 16:99 / 16 99 / 16.99 => 16.99 (point). Jamais de virgule en JSON.
5. Devise: 'EUR' si symbole € ou si d'autres montants l'utilisent clairement.
6. Pas d'hallucination: si un champ n'apparaît pas clairement -> null.
7. Articles: ignorer les lignes ne contenant ni référence ni prix.
8. Si un article a plusieurs prix (normal / réduit), le plus petit = prix_unitaire, le plus grand = total_ligne.
9. Ne jamais inventer de coloris; seulement si mot couleur explicite.
10. confidence entre 0 et 1 (approxime fiabilité globale de la structuration).

EXEMPLES (few-shot) — NE PAS réémettre ces exemples, ils servent de guide:
Exemple OCR fragment:
"""
NUMERO CLIENT: 170610229   Code privilège: 4AM9
PAGE NOM DU MODELE COLORIS REFERENCE TAILLE QUANTITE PRIX UNITAIRE TOTAL
Concave TSHIRTS BLANC 281.8341 54/56 1 39,99 39,99 €
"""
Doit produire un article avec reference="281.8341", taille_ou_code="54" (ou 54 selon extraction), code_privilege="4AM9".

IMPORTANT: Retourne uniquement le JSON final, aucune explication.

TEXTE_OCR_BRUT:
"""
${limitedText}
"""`;
  }

  /**
   * Parse la réponse Groq pour notre format spécifique
   */
  parseResponse(response) {
    try {
      console.log('📝 Parsing réponse Groq...');
      
      // Nettoyer la réponse (supprimer markdown, etc.)
      let cleanResponse = response.replace(/```json\s*/g, '').replace(/```\s*/g, '');
      
      // Extraire le JSON
      const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonData = JSON.parse(jsonMatch[0]);
        // Validation / normalisation stricte
        const ensureNumber = (v) => {
          if (v === null || v === undefined || v === '') return null;
          const n = Number(v);
            return isNaN(n) ? null : n;
        };
        const client = jsonData.client || {};
        const livraison = jsonData.livraison || {};
        let articles = Array.isArray(jsonData.articles) ? jsonData.articles : [];
        let totaux = jsonData.totaux || {};
        // Normaliser articles
        const refRegex = /^\d{3}[.,]?\d{3,4}$/; // 3+3/4 digits
        const tailleRegex = /^\d{1,4}$/;
        articles = articles.map(a => {
          let ref = a.reference ?? null;
            if (ref) {
              ref = String(ref).trim();
              if (!refRegex.test(ref)) ref = null; else ref = ref.replace(/,/g,'.');
            }
          let taille = a.taille_ou_code ?? null;
          if (taille) {
            taille = String(taille).trim();
            if (!tailleRegex.test(taille)) taille = null;
            // éviter collision référence
            if (ref && taille && ref.includes(taille) && ref.replace(/\D/g,'').length >= 6) {
              // garder taille seulement si elle est raisonnablement courte distincte
              if (taille.length >=3) taille = null; // heuristique de prudence
            }
          }
          return {
            page_catalogue: a.page_catalogue ?? null,
            nom_produit: a.nom_produit ?? null,
            coloris: a.coloris ?? null,
            reference: ref,
            taille_ou_code: taille,
            quantite: ensureNumber(a.quantite),
            prix_unitaire: ensureNumber(a.prix_unitaire),
            total_ligne: ensureNumber(a.total_ligne),
            devise: a.devise ?? null
          };
        }).filter(a => a.reference || a.nom_produit);
        totaux = {
          sous_total_articles: ensureNumber(totaux.sous_total_articles),
          participation_frais_livraison: ensureNumber(totaux.participation_frais_livraison),
          total_commande: ensureNumber(totaux.total_commande),
          total_avec_frais: ensureNumber(totaux.total_avec_frais),
          devise: totaux.devise ?? (articles.length ? 'EUR' : null)
        };
        // Validation code privilège finale
        const normalizeCodePriv = (cp) => {
          if (!cp) return null;
          let v = String(cp).toUpperCase().replace(/\s+/g,'');
    v = v.replace(/O/g,'0').replace(/I/g,'1');
            if (v.length <3 || v.length>4) return null;
          const digits=(v.match(/\d/g)||[]).length;
          if (!/[A-Z]/.test(v) || digits===0 || digits>=4) return null;
          if (/^\d{3,}$/.test(v)) return null;
          return v;
        };
        const extracted = {
          client: {
            nom_complet: client.nom_complet ?? null,
             numero_client: client.numero_client?.substring(0, 9) ?? null,
            code_privilege: normalizeCodePriv(client.code_privilege ?? null),
            telephone_portable: client.telephone_portable ?? null,
            telephone_fixe: client.telephone_fixe ?? null,
            date_naissance: client.date_naissance ?? null,
            email: client.email ?? null
          },
          livraison: {
            livraison_domicile: livraison.livraison_domicile ?? null,
            point_relais_principal: livraison.point_relais_principal ?? null,
            autre_point_relais: livraison.autre_point_relais ?? null
          },
            articles,
            totaux,
          confidence: typeof jsonData.confidence === 'number' ? Math.min(1, Math.max(0, jsonData.confidence)) : 0.9,
          method: 'groq_llama4'
        };
        console.log('✅ JSON Groq parsé (schema client/livraison/articles/totaux)');
        console.log(`📊 Articles trouvés: ${articles.length}`);
        return extracted;
      }
      
      throw new Error('Aucun JSON valide trouvé');
      
    } catch (error) {
      console.warn('⚠️ Erreur parsing Groq:', error.message);
      
      // Fallback minimal
      return {
        client: { nom_complet: null },
        livraison: {},
        articles: [],
        totaux: {},
        confidence: 0.3,
        method: 'groq_fallback',
        error: error.message
      };
    }
  }

  /**
   * Parsing de secours
   */
  fallbackParsing(response, extracted) {
    // Extraction nom
    const nomMatch = response.match(/(?:nom|client)[\s"':]*([A-Z\s]+[A-Z])/i);
    if (nomMatch) extracted.nom = nomMatch[1].trim();

    // Extraction téléphone
    const telMatch = response.match(/(?:telephone|tel)[\s"':]*([0-9\s]+)/i);
    if (telMatch) extracted.telephone = telMatch[1].trim();

    // Extraction total
    const totalMatch = response.match(/(?:total|montant)[\s"':]*([0-9,.\s€]+)/i);
    if (totalMatch) extracted.total = totalMatch[1].trim();

    extracted.confidence = 0.7;
    return extracted;
  }

  /**
   * Méthodes de compatibilité
   */
  async extractReferences(ocrText, knownReferences = []) {
    const structured = await this.extractStructuredInfo(ocrText);
    
    return {
      extractedReferences: structured.articles || [],
      confidence: structured.confidence,
      validated: structured.articles || [],
      metadata: {
        totalFound: structured.articles ? structured.articles.length : 0,
        method: structured.method || 'groq_llm'
      }
    };
  }

  async analyzeContext(ocrText) {
    return {
      documentType: 'bon_de_commande',
      hasTableStructure: /PAGE\s+NOM\s+DU\s+MODÈLE/.test(ocrText),
      hasPersonalInfo: /MADAME|MONSIEUR/.test(ocrText),
      confidence: 0.9,
      extractionStrategy: 'groq_ai'
    };
  }
}

export default GroqLLMService;