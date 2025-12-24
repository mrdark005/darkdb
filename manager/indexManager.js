const { EventEmitter } = require("events");

class IndexManager extends EventEmitter {
    constructor(options = {}) {
        super();
        this.indexes = new Map();
        this.fields = options.fields || ["title", "description"];
    }

    update(key, value) {
        this.delete(key);
        if (typeof value === "object" && value !== null) {
            for (const field of this.fields) {
                if (value[field] && typeof value[field] === "string") {
                    this.indexText(key, value[field]);
                }
            }
        }
    }

    indexText(key, text) {
        const words = text.toLowerCase().split(/\s+/).filter(Boolean);
        for (const word of words) {
            if (!this.indexes.has(word)) {
                this.indexes.set(word, new Set());
            }
            this.indexes.get(word).add(key);
        }
    }

    delete(key) {
        for (const [word, keys] of this.indexes.entries()) {
            if (keys.has(key)) {
                keys.delete(key);
                if (keys.size === 0) {
                    this.indexes.delete(word);
                }
            }
        }
    }

    search(query) {
        const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (queryWords.length === 0) return [];

        let results = new Set(this.indexes.get(queryWords[0]) || []);
        if (results.size === 0) return [];

        for (let i = 1; i < queryWords.length; i++) {
            const wordResults = this.indexes.get(queryWords[i]);
            if (!wordResults) {
                return [];
            }
            results = new Set([...results].filter((x) => wordResults.has(x)));
        }

        return Array.from(results);
    }

    clear() {
        this.indexes.clear();
    }
}

module.exports = IndexManager;