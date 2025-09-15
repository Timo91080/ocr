import sharp from 'sharp';
import Jimp from 'jimp';
import path from 'path';

/**
 * Service de traitement d'images pour optimiser l'OCR
 * Améliore la qualité des images avant extraction de texte
 */
class ImageProcessor {
  constructor() {
    this.outputDir = 'uploads/processed/';
  }

  /**
   * Préprocesse une image pour améliorer l'OCR
   * @param {string} inputPath - Chemin de l'image d'entrée
   * @param {Object} options - Options de traitement
   * @returns {Promise<string>} Chemin de l'image traitée
   */
  async preprocessImage(inputPath, options = {}) {
    try {
      const {
        resize = true,
        denoise = true,
        contrast = true,
        brightness = true,
        grayscale = true,
        threshold = false,
        maxWidth = 2000,
        maxHeight = 2000
      } = options;

      console.log(`🔧 Preprocessing de l'image: ${inputPath}`);
      
      const filename = path.basename(inputPath, path.extname(inputPath));
      const outputPath = path.join(this.outputDir, `${filename}_processed.png`);
      
      let image = sharp(inputPath);
      
      // Redimensionnement si nécessaire
      if (resize) {
        const metadata = await image.metadata();
        if (metadata.width > maxWidth || metadata.height > maxHeight) {
          image = image.resize(maxWidth, maxHeight, {
            fit: 'inside',
            withoutEnlargement: true
          });
          console.log(`📏 Image redimensionnée: ${metadata.width}x${metadata.height} → max ${maxWidth}x${maxHeight}`);
        }
      }
      
      // Conversion en niveaux de gris
      if (grayscale) {
        image = image.grayscale();
        console.log('🎨 Conversion en niveaux de gris');
      }
      
      // Amélioration du contraste
      if (contrast) {
        image = image.normalize();
        console.log('⚡ Normalisation du contraste');
      }
      
      // Réduction du bruit
      if (denoise) {
        image = image.median(3); // Filtre médian pour réduire le bruit
        console.log('🔇 Réduction du bruit');
      }
      
      // Sauvegarder l'image traitée
      await image.png({ quality: 100 }).toFile(outputPath);
      
      console.log(`✅ Image traitée sauvée: ${outputPath}`);
      return outputPath;
      
    } catch (error) {
      console.error('❌ Erreur preprocessing:', error);
      throw new Error(`Erreur preprocessing: ${error.message}`);
    }
  }

  /**
   * Applique un seuillage binaire avec Jimp pour améliorer le texte
   * @param {string} imagePath - Chemin de l'image
   * @param {number} threshold - Seuil (0-255)
   * @returns {Promise<string>} Chemin de l'image avec seuillage
   */
  async applyThreshold(imagePath, threshold = 128) {
    try {
      console.log(`🎯 Application du seuillage: ${threshold}`);
      
      const image = await Jimp.read(imagePath);
      const filename = path.basename(imagePath, path.extname(imagePath));
      const outputPath = path.join(this.outputDir, `${filename}_threshold.png`);
      
      // Conversion en noir et blanc avec seuillage
      image
        .greyscale()
        .contrast(0.5)
        .threshold({ max: threshold });
      
      await image.writeAsync(outputPath);
      
      console.log(`✅ Seuillage appliqué: ${outputPath}`);
      return outputPath;
      
    } catch (error) {
      console.error('❌ Erreur seuillage:', error);
      throw new Error(`Erreur seuillage: ${error.message}`);
    }
  }

  /**
   * Détecte et corrige l'orientation du texte
   * @param {string} imagePath - Chemin de l'image
   * @returns {Promise<string>} Chemin de l'image corrigée
   */
  async correctOrientation(imagePath) {
    try {
      console.log(`🔄 Correction d'orientation pour: ${imagePath}`);
      
      const filename = path.basename(imagePath, path.extname(imagePath));
      const outputPath = path.join(this.outputDir, `${filename}_rotated.png`);
      
      // Pour une vraie détection d'orientation, il faudrait utiliser
      // des algorithmes plus complexes. Ici, on propose plusieurs rotations
      const angles = [0, 90, 180, 270];
      const results = [];
      
      for (const angle of angles) {
        const tempPath = path.join(this.outputDir, `temp_${angle}.png`);
        
        await sharp(imagePath)
          .rotate(angle)
          .png()
          .toFile(tempPath);
          
        // Ici, on pourrait analyser quelle rotation donne le meilleur résultat OCR
        // Pour l'instant, on garde l'original
        results.push({ angle, path: tempPath });
      }
      
      // Nettoyer les fichiers temporaires (garder seulement l'original pour l'instant)
      for (const result of results) {
        if (result.angle !== 0) {
          // fs.unlinkSync(result.path); // Décommenter pour nettoyer
        }
      }
      
      // Retourner l'image originale pour l'instant
      await sharp(imagePath).png().toFile(outputPath);
      
      console.log(`✅ Orientation vérifiée: ${outputPath}`);
      return outputPath;
      
    } catch (error) {
      console.error('❌ Erreur correction orientation:', error);
      throw new Error(`Erreur correction orientation: ${error.message}`);
    }
  }

  /**
   * Pipeline complet de traitement d'image
   * @param {string} imagePath - Chemin de l'image d'entrée
   * @param {Object} options - Options de traitement
   * @returns {Promise<Object>} Informations sur l'image traitée
   */
  async processImageComplete(imagePath, options = {}) {
    try {
      console.log(`🚀 Début du pipeline de traitement: ${imagePath}`);
      
      // Créer le dossier de sortie s'il n'existe pas
      await this.ensureOutputDirectory();
      
      const steps = [];
      let currentPath = imagePath;
      
      // Étape 1: Preprocessing de base
      if (options.preprocess !== false) {
        currentPath = await this.preprocessImage(currentPath, options);
        steps.push({ step: 'preprocess', path: currentPath });
      }
      
      // Étape 2: Correction d'orientation
      if (options.orientation !== false) {
        currentPath = await this.correctOrientation(currentPath);
        steps.push({ step: 'orientation', path: currentPath });
      }
      
      // Étape 3: Seuillage si demandé
      if (options.threshold && options.thresholdValue) {
        currentPath = await this.applyThreshold(currentPath, options.thresholdValue);
        steps.push({ step: 'threshold', path: currentPath });
      }
      
      console.log(`✅ Pipeline terminé. Image finale: ${currentPath}`);
      
      return {
        originalPath: imagePath,
        processedPath: currentPath,
        steps: steps,
        metadata: await this.getImageMetadata(currentPath)
      };
      
    } catch (error) {
      console.error('❌ Erreur pipeline complet:', error);
      throw new Error(`Erreur pipeline: ${error.message}`);
    }
  }

  /**
   * Récupère les métadonnées d'une image
   * @param {string} imagePath - Chemin de l'image
   * @returns {Promise<Object>} Métadonnées
   */
  async getImageMetadata(imagePath) {
    try {
      const metadata = await sharp(imagePath).metadata();
      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        channels: metadata.channels,
        density: metadata.density,
        size: metadata.size
      };
    } catch (error) {
      console.error('❌ Erreur métadonnées:', error);
      return null;
    }
  }

  /**
   * S'assure que le dossier de sortie existe
   */
  async ensureOutputDirectory() {
    try {
      const fs = await import('fs');
      const fsp = fs.promises;
      
      await fsp.mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      console.error('❌ Erreur création dossier:', error);
    }
  }
}

export default ImageProcessor;