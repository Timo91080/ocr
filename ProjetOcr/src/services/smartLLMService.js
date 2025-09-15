import OllamaLLMService from './ollamaLLMService.js';
import OpenAILLMService from './openaiLLMService.js';
import GroqLLMService from './groqLLMService.js';

/**
 * Gestionnaire intelligent multi-IA
 * Choisit automatiquement la meilleure IA disponible
 */
class SmartLLMService {
  constructor() {
    console.log('🤖 Initialisation SmartLLMService...');
    
    // Services disponibles (initialisation lazy pour éviter les erreurs de clés API)
    this.services = {};
    this.serviceClasses = {
      ollama: OllamaLLMService,
      groq: GroqLLMService,
      openai: OpenAILLMService
    };
    
    // Ordre de préférence basé sur LLM_PROVIDER - GROQ EN FORCE
    const provider = process.env.LLM_PROVIDER?.toLowerCase() || 'ollama';
    if (provider === 'groq') {
      this.preferenceOrder = ['groq']; // FORCE GROQ SEULEMENT
    } else if (provider === 'openai') {
      this.preferenceOrder = ['openai', 'groq'];
    } else {
      this.preferenceOrder = ['groq', 'ollama']; // Groq d'abord par défaut
    }
    this.currentService = null;
    
    console.log('✅ SmartLLMService initialisé (lazy loading)');
  }

  /**
   * Initialise un service si pas encore fait
   */
  getOrCreateService(serviceName) {
    if (!this.services[serviceName]) {
      try {
        console.log(`🔧 Initialisation service ${serviceName}...`);
        const ServiceClass = this.serviceClasses[serviceName];
        this.services[serviceName] = new ServiceClass();
        console.log(`✅ Service ${serviceName} initialisé`);
      } catch (error) {
        console.log(`❌ Échec initialisation ${serviceName}:`, error.message);
        return null;
      }
    }
    return this.services[serviceName];
  }

  /**
   * Sélectionne automatiquement la meilleure IA disponible
   */
  async selectBestService() {
    console.log('🎯 Sélection de la meilleure IA disponible...');
    
    for (const serviceName of this.preferenceOrder) {
      const service = this.getOrCreateService(serviceName);
      if (!service) continue;
      
      try {
        // Test spécifique pour chaque service
        let isAvailable = false;
        
        switch (serviceName) {
          case 'ollama':
            isAvailable = await service.isAvailable();
            break;
          case 'groq':
            isAvailable = service.isAvailable();
            break;
          case 'openai':
            isAvailable = service.isAvailable();
            break;
          case 'huggingface':
            isAvailable = true; // Toujours disponible (fallback)
            break;
        }
        
        if (isAvailable) {
          this.currentService = service;
          console.log(`✅ Service sélectionné: ${serviceName.toUpperCase()}`);
          return service;
        } else {
          console.log(`❌ ${serviceName} non disponible`);
        }
        
      } catch (error) {
        console.log(`❌ Erreur ${serviceName}:`, error.message);
      }
    }
    
    // Aucun service disponible
    throw new Error('❌ Aucun service d\'IA disponible ! Vérifiez Ollama, Groq ou OpenAI.');
  }

  /**
   * Extraction avec la meilleure IA disponible
   */
  async extractStructuredInfo(ocrText) {
    if (!this.currentService) {
      await this.selectBestService();
    }
    
    try {
      const result = await this.currentService.extractStructuredInfo(ocrText);
      console.log(`🎯 Extraction réussie avec ${this.currentService.constructor.name}`);
      return result;
      
    } catch (error) {
      console.log(`❌ Erreur avec service actuel, changement...`);
      
      // Essayer le service suivant
      const currentIndex = this.preferenceOrder.indexOf(this.getCurrentServiceName());
      const nextServices = this.preferenceOrder.slice(currentIndex + 1);
      
      for (const serviceName of nextServices) {
        try {
          console.log(`🔄 Tentative avec ${serviceName}...`);
          const service = this.getOrCreateService(serviceName);
          if (!service) continue;
          
          this.currentService = service;
          const result = await service.extractStructuredInfo(ocrText);
          console.log(`✅ Succès avec ${serviceName}`);
          return result;
          
        } catch (nextError) {
          console.log(`❌ ${serviceName} échoué:`, nextError.message);
        }
      }
      
      // Si tout échoue, utiliser le fallback HuggingFace
      console.log('🔧 Utilisation fallback HuggingFace...');
      const fallbackService = this.getOrCreateService('huggingface');
      if (fallbackService) {
        this.currentService = fallbackService;
        return await fallbackService.extractStructuredInfo(ocrText);
      } else {
        throw new Error('Aucun service AI disponible');
      }
    }
  }

  /**
   * Obtient le nom du service actuel
   */
  getCurrentServiceName() {
    if (!this.currentService) return 'none';
    
    const serviceName = this.currentService.constructor.name;
    return serviceName.replace('LLMService', '').toLowerCase();
  }

  /**
   * Force l'utilisation d'un service spécifique
   */
  forceService(serviceName) {
    if (this.serviceClasses[serviceName]) {
      const service = this.getOrCreateService(serviceName);
      if (service) {
        this.currentService = service;
        console.log(`🔧 Service forcé: ${serviceName}`);
      } else {
        console.error(`❌ Impossible d'initialiser ${serviceName}`);
      }
    } else {
      console.error(`❌ Service ${serviceName} non trouvé`);
    }
  }

  /**
   * Obtient le statut de tous les services
   */
  async getServicesStatus() {
    const status = {};
    
    for (const serviceName of Object.keys(this.serviceClasses)) {
      try {
        const service = this.getOrCreateService(serviceName);
        let isAvailable = false;
        
        if (service) {
          switch (serviceName) {
            case 'ollama':
              isAvailable = await service.isAvailable();
              break;
            case 'groq':
            case 'openai':
              isAvailable = service.isAvailable();
              break;
            case 'huggingface':
              isAvailable = true;
              break;
          }
        }
        
        status[serviceName] = {
          available: isAvailable,
          description: this.getServiceDescription(serviceName)
        };
        
      } catch (error) {
        status[serviceName] = {
          available: false,
          error: error.message,
          description: this.getServiceDescription(serviceName)
        };
      }
    }
    
    return status;
  }

  /**
   * Description des services
   */
  getServiceDescription(serviceName) {
    const descriptions = {
      ollama: 'IA locale gratuite (recommandé)',
      groq: 'IA rapide gratuite',
      openai: 'IA premium payante',
      huggingface: 'IA gratuite (fallback)'
    };
    
    return descriptions[serviceName] || 'Service IA';
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
        method: structured.method || 'smart_ai',
        service: this.getCurrentServiceName()
      }
    };
  }

  async analyzeContext(ocrText) {
    if (!this.currentService) {
      await this.selectBestService();
    }
    
    const context = await this.currentService.analyzeContext(ocrText);
    context.aiService = this.getCurrentServiceName();
    return context;
  }
}

export default SmartLLMService;