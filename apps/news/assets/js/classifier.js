// CategoryClassifier — on-device category classification via ml-classify-text-js
import { Classifier } from './vendor/classifier.esm.js';

const CATEGORIES = ['world', 'technology', 'business', 'science', 'health', 'sports', 'entertainment'];

export class CategoryClassifier {
  constructor() {
    this.classifier = new Classifier({ nGramSize: 2 });
    this.trained = false;
  }

  /**
   * Train the classifier on articles grouped by category.
   * @param {object} articlesByCategory - { category: [article, ...] }
   */
  train(articlesByCategory) {
    if (!articlesByCategory) return;
    for (const [category, articles] of Object.entries(articlesByCategory)) {
      if (!articles || !articles.length) continue;
      for (const article of articles) {
        const text = `${article.title || ''} ${article.description || ''}`.toLowerCase().trim();
        if (text.length > 5) {
          this.classifier.train(text, category);
        }
      }
    }
    this.trained = true;
  }

  /**
   * Classify a text string into a category.
   * @param {string} text - Text to classify (title + description)
   * @returns {{ category: string, confidence: number, allScores: Array }}
   */
  classify(text) {
    if (!this.trained || !text) {
      return { category: 'world', confidence: 0, allScores: [] };
    }
    const result = this.classifier.classify(text.toLowerCase());
    return {
      category: result.label,
      confidence: result.confidence,
      allScores: result.scores.map(s => ({ category: s.label, confidence: s.confidence })),
    };
  }

  /**
   * Get the best category for a text, with a confidence threshold.
   * Falls back to 'world' if confidence is below threshold.
   * @param {string} text - Text to classify
   * @param {number} [threshold=0.3] - Minimum confidence
   * @returns {string} Category label
   */
  getCategory(text, threshold = 0.3) {
    const result = this.classify(text);
    return result.confidence >= threshold ? result.category : 'world';
  }

  /**
   * Serialize the classifier for persistence.
   * @returns {object} JSON-serializable data
   */
  toJSON() {
    return this.classifier.toJSON();
  }

  /**
   * Restore a serialized classifier.
   * @param {object} json - Data from toJSON()
   * @returns {CategoryClassifier} Restored instance
   */
  static fromJSON(json) {
    const cc = new CategoryClassifier();
    cc.classifier = Classifier.fromJSON(json);
    cc.trained = true;
    return cc;
  }
}
