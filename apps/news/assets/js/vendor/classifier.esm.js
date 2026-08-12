/**
 * ml-classify-text-js
 * Lightweight Multinomial Naive Bayes text classifier — zero dependencies.
 *
 * Implements:
 *   P(label | text) ∝ P(label) × ∏ P(word | label)
 *
 * Uses log-probabilities to avoid floating-point underflow, and
 * Laplace (add-k) smoothing to handle unseen words gracefully.
 */

// ---------------------------------------------------------------------------
// Tokenisation
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','it','its','this','that','was','are','be','been','been',
  'has','have','had','do','does','did','will','would','could','should','may',
  'might','shall','not','no','nor','so','yet','both','either','each','few',
  'more','most','other','some','such','than','too','very','just','as','if',
  'then','because','while','although','though','when','where','who','which',
  'what','how','all','any','both','each','i','you','he','she','we','they',
  'me','him','her','us','them','my','your','his','our','their',
]);

/**
 * Tokenise a string into lowercase words, removing stop words and punctuation.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {boolean} [opts.removeStopWords=true]
 * @param {number}  [opts.ngramSize=1] - also generate n-grams up to this size
 * @returns {string[]}
 */
function tokenize(text, opts = {}) {
  const { removeStopWords = true, ngramSize = 1 } = opts;

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^['\-]+|['\-]+$/g, ''))
    .filter(w => w.length > 1 && (!removeStopWords || !STOP_WORDS.has(w)));

  if (ngramSize <= 1) return words;

  const tokens = [...words];
  for (let n = 2; n <= ngramSize; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      tokens.push(words.slice(i, i + n).join('_'));
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

class Classifier {
  /**
   * @param {object} [options]
   * @param {number} [options.smoothing=1]   Laplace smoothing factor (k). 0 = no smoothing.
   * @param {boolean} [options.removeStopWords=true]
   * @param {number}  [options.ngramSize=1]  Include bigrams, trigrams, etc.
   */
  constructor(options = {}) {
    this.smoothing = options.smoothing ?? 1;
    this.removeStopWords = options.removeStopWords ?? true;
    this.ngramSize = options.ngramSize ?? 1;

    /** @type {Map<string, { wordCounts: Map<string,number>, totalWords: number, docCount: number }>} */
    this._labels = new Map();
    /** @type {Set<string>} */
    this._vocabulary = new Set();
    this._totalDocs = 0;
  }

  // -------------------------------------------------------------------------
  // Training
  // -------------------------------------------------------------------------

  /**
   * Train the classifier with a single text sample.
   *
   * @param {string} text
   * @param {string} label
   * @returns {this}
   */
  train(text, label) {
    if (typeof text !== 'string' || !text.trim()) {
      throw new TypeError('text must be a non-empty string');
    }
    if (typeof label !== 'string' || !label.trim()) {
      throw new TypeError('label must be a non-empty string');
    }

    const words = tokenize(text, {
      removeStopWords: this.removeStopWords,
      ngramSize: this.ngramSize,
    });

    if (!this._labels.has(label)) {
      this._labels.set(label, { wordCounts: new Map(), totalWords: 0, docCount: 0 });
    }

    const entry = this._labels.get(label);
    entry.docCount++;
    this._totalDocs++;

    for (const word of words) {
      this._vocabulary.add(word);
      entry.wordCounts.set(word, (entry.wordCounts.get(word) ?? 0) + 1);
      entry.totalWords++;
    }

    return this;
  }

  /**
   * Train with multiple samples at once.
   *
   * @param {Array<{ text: string, label: string }>} samples
   * @returns {this}
   */
  trainAll(samples) {
    for (const { text, label } of samples) {
      this.train(text, label);
    }
    return this;
  }

  // -------------------------------------------------------------------------
  // Prediction
  // -------------------------------------------------------------------------

  /**
   * Compute log-probability scores for every trained label.
   *
   * @param {string} text
   * @returns {Array<{ label: string, score: number, confidence: number }>}
   *   Sorted best-first. `confidence` is the softmax-normalised probability.
   */
  scores(text) {
    if (this._totalDocs === 0) {
      throw new Error('Classifier has not been trained yet. Call train() first.');
    }

    const words = tokenize(text, {
      removeStopWords: this.removeStopWords,
      ngramSize: this.ngramSize,
    });
    const vocabSize = this._vocabulary.size;
    const k = this.smoothing;

    const raw = [];

    for (const [label, entry] of this._labels) {
      // Prior: log P(label)
      let logProb = Math.log(entry.docCount / this._totalDocs);

      // Likelihood: log P(word | label) with Laplace smoothing
      for (const word of words) {
        const wordCount = entry.wordCounts.get(word) ?? 0;
        logProb += Math.log((wordCount + k) / (entry.totalWords + k * vocabSize));
      }

      raw.push({ label, score: logProb });
    }

    // Sort best-first
    raw.sort((a, b) => b.score - a.score);

    // Softmax over log-scores for interpretable confidence values
    const maxScore = raw[0].score;
    const expSum = raw.reduce((s, r) => s + Math.exp(r.score - maxScore), 0);

    return raw.map(r => ({
      label: r.label,
      score: r.score,
      confidence: Math.exp(r.score - maxScore) / expSum,
    }));
  }

  /**
   * Classify text, returning the best label and its confidence.
   *
   * @param {string} text
   * @returns {{ label: string, confidence: number, scores: Array<{ label: string, score: number, confidence: number }> }}
   */
  classify(text) {
    const all = this.scores(text);
    return {
      label: all[0].label,
      confidence: all[0].confidence,
      scores: all,
    };
  }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  /** Returns all trained labels. */
  getLabels() {
    return [...this._labels.keys()];
  }

  /** Returns the number of documents the classifier was trained on. */
  get documentCount() {
    return this._totalDocs;
  }

  /** Returns the size of the vocabulary. */
  get vocabularySize() {
    return this._vocabulary.size;
  }

  /**
   * Top N most informative words for a label (by word count within that label).
   *
   * @param {string} label
   * @param {number} [n=10]
   * @returns {Array<{ word: string, count: number }>}
   */
  topWords(label, n = 10) {
    const entry = this._labels.get(label);
    if (!entry) throw new Error(`Unknown label: "${label}"`);
    return [...entry.wordCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([word, count]) => ({ word, count }));
  }

  // -------------------------------------------------------------------------
  // Serialisation
  // -------------------------------------------------------------------------

  /**
   * Export the trained model as a plain JSON-serialisable object.
   * @returns {object}
   */
  toJSON() {
    return {
      smoothing: this.smoothing,
      removeStopWords: this.removeStopWords,
      ngramSize: this.ngramSize,
      totalDocs: this._totalDocs,
      vocabulary: [...this._vocabulary],
      labels: Object.fromEntries(
        [...this._labels.entries()].map(([label, entry]) => [
          label,
          {
            docCount: entry.docCount,
            totalWords: entry.totalWords,
            wordCounts: Object.fromEntries(entry.wordCounts),
          },
        ])
      ),
    };
  }

  /**
   * Restore a classifier from a serialised object (produced by toJSON()).
   *
   * @param {object} data
   * @returns {Classifier}
   */
  static fromJSON(data) {
    const clf = new Classifier({
      smoothing: data.smoothing,
      removeStopWords: data.removeStopWords,
      ngramSize: data.ngramSize,
    });
    clf._totalDocs = data.totalDocs;
    clf._vocabulary = new Set(data.vocabulary);
    clf._labels = new Map(
      Object.entries(data.labels).map(([label, entry]) => [
        label,
        {
          docCount: entry.docCount,
          totalWords: entry.totalWords,
          wordCounts: new Map(Object.entries(entry.wordCounts)),
        },
      ])
    );
    return clf;
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

/**
 * Create a new Classifier instance.
 *
 * @param {object} [options]
 * @returns {Classifier}
 */
function createClassifier(options) {
  return new Classifier(options);
}

export { Classifier, createClassifier, tokenize, STOP_WORDS };
export default createClassifier;
