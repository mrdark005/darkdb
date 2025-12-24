const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { EventEmitter } = require("events");

const JsonDriver = require("./drivers/JsonDriver");
const YamlDriver = require("./drivers/YamlDriver");
const BinaryDriver = require("./drivers/BinaryDriver");
const TomlDriver = require("./drivers/TomlDriver");

const IndexManager = require("./manager/indexManager");

class Mutex {
    constructor() {
        this.queue = [];
        this.locked = false;
    }
    async run(fn) {
        return new Promise((resolve, reject) => {
            const task = async () => {
                try {
                    const res = await fn();
                    resolve(res);
                } catch (e) {
                    reject(e);
                } finally {
                    this._next();
                }
            };
            this.queue.push(task);
            if (!this.locked) this._next();
        });
    }
    _next() {
        const t = this.queue.shift();
        if (!t) {
            this.locked = false;
            return;
        }
        this.locked = true;
        t();
    }
}

class DarkDB {
    constructor(options = {}) {
        this.name = options.name || "darkdb";
        this.dir = options.dir || process.cwd();
        this.format = options.format || "json";

        if (this.format === "yaml") {
            this.fileExtension = "yaml";
        } else if (this.format === "binary") {
            this.fileExtension = "bin";
        } else {
            this.fileExtension = "json";
        }

        this.file = path.resolve(this.dir, `${this.name}.${this.fileExtension}`);
        this.metaFile = path.resolve(this.dir, `${this.name}.meta.json`);
        this.separator = options.separator ?? ".";
        this.autoFile = options.autoFile ?? true;
        this.debounceMs = options.debounceMs ?? 25;
        this.atomic = options.atomic ?? true;
        this.shard = options.shard ?? false;
        this.schema = options.schema || null;
        this.indexFields = options.indexFields || ["title", "description"];
        this._hooks = {
            pre: {},
            post: {}
        };

        if (this.format === "json") {
            this.driver = new JsonDriver({ jsonSpaces: options.jsonSpaces });
            this.fileExtension = "json";
        } else if (this.format === "yaml") {
            this.driver = new YamlDriver();
            this.fileExtension = "yaml";
        } else if (this.format === "toml") {
            this.driver = new TomlDriver();
            this.fileExtension = "toml";
        } else if (this.format === "binary") {
            this.driver = new BinaryDriver();
            this.fileExtension = "bin";
        } else {
            throw new Error(`Unsupported file format: ${this.format}`);
        }

        this._data = {};
        this._expires = {};
        this._saveTimer = null;
        this._emitter = new EventEmitter();
        this._mutex = new Mutex();
        this._indexManager = new IndexManager({ fields: this.indexFields });

        if (this.autoFile) {
            this._loadDataSync();
        }
    }

    pre(action, fn) {
        if (!this._hooks.pre[action]) this._hooks.pre[action] = [];
        this._hooks.pre[action].push(fn);
    }

    post(action, fn) {
        if (!this._hooks.post[action]) this._hooks.post[action] = [];
        this._hooks.post[action].push(fn);
    }

    _validateSchema(key, value) {
        if (!this.schema) return;
        for (const [field, type] of Object.entries(this.schema)) {
            if (value[field] !== undefined) {
                if (type === String && typeof value[field] !== "string") {
                    throw new Error(`Schema validation failed: ${field} must be a string`);
                }
                if (type === Number && typeof value[field] !== "number") {
                    throw new Error(`Schema validation failed: ${field} must be a number`);
                }
                if (type === Boolean && typeof value[field] !== "boolean") {
                    throw new Error(`Schema validation failed: ${field} must be a boolean`);
                }
            }
        }
    }

    async _runHooks(type, action, payload) {
        const hooks = this._hooks[type][action] || [];
        for (const hook of hooks) {
            await hook(payload);
        }
    }

    _loadDataSync() {
        try {
            if (fs.existsSync(this.file)) {
                const result = this.driver.read(this.file);
                if (result instanceof Promise) {
                    throw new Error("Binary driver read() cannot be sync. Use autoFile:false and load async.");
                }
                this._data = result;
            }
            if (fs.existsSync(this.metaFile)) {
                this._expires = JSON.parse(fs.readFileSync(this.metaFile, "utf8"));
            }
        } catch (e) {
            console.error("DarkDB load error:", e?.message || e);
            this._data = {};
            this._expires = {};
        }
        this._rebuildIndex();
        this._cleanupExpiredSync();
    }

    _rebuildIndex() {
        this._indexManager.clear();
        const indexRecursive = (obj, currentKey) => {
            if (typeof obj === "object" && obj !== null) {
                this._indexManager.update(currentKey, obj);
                for (const key in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, key)) {
                        const newKey = currentKey ? `${currentKey}${this.separator}${key}` : key;
                        indexRecursive(obj[key], newKey);
                    }
                }
            }
        };
        indexRecursive(this._data, "");
    }

    _resolvePath(key) {
        if (typeof key !== "string" || !key.length)
            throw new Error("Key cannot be an empty string.");
        return key.split(this.separator).filter(Boolean);
    }

    _getRef(keys, create = false) {
        let obj = this._data;
        for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (obj[k] == null) {
                if (create) obj[k] = {};
                else return [null, null];
            }
            if (typeof obj[k] !== "object") {
                if (create) obj[k] = {};
                else return [null, null];
            }
            obj = obj[k];
        }
        return [obj, keys[keys.length - 1]];
    }

    _scheduleSave() {
        if (!this.autoFile) return;
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            this._mutex.run(() => this._saveNow());
        }, this.debounceMs);
    }

    async _saveNow() {
        const metaBody = JSON.stringify(this._expires, null, 2);
        await fsp.mkdir(this.dir, { recursive: true });
        if (this.atomic) {
            const tmpFile = this.file + ".tmp";
            const tmpMetaFile = this.metaFile + ".tmp";
            await this.driver.write(tmpFile, this._data);
            await fsp.writeFile(tmpMetaFile, metaBody, "utf8");
            await fsp.rename(tmpFile, this.file);
            await fsp.rename(tmpMetaFile, this.metaFile);
        } else {
            await this.driver.write(this.file, this._data);
            await fsp.writeFile(this.metaFile, metaBody, "utf8");
        }
    }

    _emit(type, payload) {
        this._emitter.emit(type, payload);
        this._emitter.emit("change", { type, ...payload });
    }

    _isExpired(keyPath) {
        const exp = this._expires[keyPath];
        return typeof exp === "number" && Date.now() >= exp;
    }

    _cleanupExpiredSync() {
        let changed = false;
        for (const [k, exp] of Object.entries(this._expires)) {
            if (Date.now() >= exp) {
                this._deleteSync(k);
                delete this._expires[k];
                changed = true;
            }
        }
        if (changed) this._scheduleSave();
    }

    _getSync(key) {
        const keys = this._resolvePath(key);
        let obj = this._data;
        for (const k of keys) {
            if (obj == null || typeof obj !== "object" || !(k in obj))
                return undefined;
            obj = obj[k];
        }
        return obj;
    }

    _setSync(key, value) {
        const keys = this._resolvePath(key);
        const [ref, last] = this._getRef(keys, true);
        const oldValue = ref[last];
        ref[last] = value;

        if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
            this._indexManager.update(key, value);
        }

        this._emit("set", { key, value });
        this._scheduleSave();
        return value;
    }

    _deleteSync(key) {
        const keys = this._resolvePath(key);
        const [ref, last] = this._getRef(keys, false);
        if (!ref || !(last in ref)) return false;
        delete ref[last];
        this._indexManager.delete(key);
        this._emit("delete", { key });
        this._scheduleSave();
        return true;
    }

    async set(key, value, opts = {}) {
        return this._mutex.run(async () => {
            if (this.schema) {
                this._validateSchema(key, value);
            }
            await this._runHooks("pre", "set", { key, value });
            const v = this._setSync(key, value);
            if (opts && typeof opts.ttlMs === "number" && opts.ttlMs > 0) {
                this._expires[key] = Date.now() + opts.ttlMs;
            } else {
                delete this._expires[key];
            }
            await this._runHooks("post", "set", { key, value });
            return v;
        });
    }

    async get(key) {
        return this._mutex.run(async () => {
            this._cleanupExpiredSync();
            if (this._isExpired(key)) {
                this._deleteSync(key);
                delete this._expires[key];
                return undefined;
            }
            return this._getSync(key);
        });
    }

    async has(key) {
        return (await this.get(key)) !== undefined;
    }

    async delete(key) {
        return this._mutex.run(async () => {
            await this._runHooks("pre", "delete", { key });
            const ok = this._deleteSync(key);
            delete this._expires[key];
            await this._runHooks("post", "delete", { key });
            return ok;
        });
    }

    async all() {
        return this._mutex.run(async () => {
            this._cleanupExpiredSync();
            return JSON.parse(JSON.stringify(this._data));
        });
    }

    async deleteAll() {
        return this._mutex.run(async () => {
            this._data = {};
            this._expires = {};
            this._indexManager.clear();
            this._emit("reset", {});
            this._scheduleSave();
            return true;
        });
    }

    async push(key, value) {
        return this._mutex.run(async () => {
            const cur = this._getSync(key);
            const arr = Array.isArray(cur) ? cur : [];
            arr.push(value);
            this._setSync(key, arr);
            return arr;
        });
    }

    async unpush(key, value) {
        return this._mutex.run(async () => {
            const cur = this._getSync(key);
            if (!Array.isArray(cur)) return [];
            const arr = cur.filter((v) => v !== value);
            this._setSync(key, arr);
            return arr;
        });
    }

    async add(key, n) {
        return this._numOp(key, +n || 0, (a, b) => a + b);
    }

    async remove(key, n) {
        return this._numOp(key, +n || 0, (a, b) => a - b);
    }

    async incr(key) {
        return this._numOp(key, 1, (a, b) => a + b);
    }

    async decr(key) {
        return this._numOp(key, 1, (a, b) => a - b);
    }

    async _numOp(key, n, op) {
        return this._mutex.run(async () => {
            const cur = this._getSync(key);
            const base = typeof cur === "number" ? cur : 0;
            const val = op(base, n);
            this._setSync(key, val);
            return val;
        });
    }

    async keys(keyPrefix = "") {
        return this._mutex.run(async () => {
            const root = keyPrefix ? this._getSync(keyPrefix) : this._data;
            if (root && typeof root === "object") return Object.keys(root);
            return [];
        });
    }

    async values(keyPrefix = "") {
        return this._mutex.run(async () => {
            const root = keyPrefix ? this._getSync(keyPrefix) : this._data;
            if (root && typeof root === "object") return Object.values(root);
            return [];
        });
    }

    async entries(keyPrefix = "") {
        return this._mutex.run(async () => {
            const root = keyPrefix ? this._getSync(keyPrefix) : this._data;
            if (root && typeof root === "object") return Object.entries(root);
            return [];
        });
    }

    async find(keyPrefix, predicate) {
        return this._mutex.run(async () => {
            const root = keyPrefix ? this._getSync(keyPrefix) : this._data;
            if (!root || typeof root !== "object") return [];
            const out = [];
            for (const [k, v] of Object.entries(root))
                if (predicate(v, k)) out.push([k, v]);
            return out;
        });
    }

    async query(keyPrefix, filter, options = {}) {
        return this._mutex.run(async () => {
            const root = keyPrefix ? this._getSync(keyPrefix) : this._data;
            if (!root || typeof root !== "object") return [];

            const match = (obj, cond) => {
                if (!cond || typeof cond !== "object") return false;

                if (cond.$and) {
                    if (!Array.isArray(cond.$and)) throw new Error("$and must be array");
                    return cond.$and.every((sub) => match(obj, sub));
                }
                if (cond.$or) {
                    if (!Array.isArray(cond.$or)) throw new Error("$or must be array");
                    return cond.$or.some((sub) => match(obj, sub));
                }
                if (cond.$not) {
                    return !match(obj, cond.$not);
                }

                for (const [field, rule] of Object.entries(cond)) {
                    const val = obj[field];

                    if (typeof rule === "object" && !Array.isArray(rule)) {
                        for (const [op, cmp] of Object.entries(rule)) {
                            switch (op) {
                                case "$eq": if (val !== cmp) return false; break;
                                case "$ne": if (val === cmp) return false; break;
                                case "$gt": if (!(val > cmp)) return false; break;
                                case "$gte": if (!(val >= cmp)) return false; break;
                                case "$lt": if (!(val < cmp)) return false; break;
                                case "$lte": if (!(val <= cmp)) return false; break;
                                case "$in": if (!cmp.includes(val)) return false; break;
                                case "$nin": if (cmp.includes(val)) return false; break;
                                case "$regex": if (!(new RegExp(cmp).test(val))) return false; break;
                                default: throw new Error(`Unknown operator ${op}`);
                            }
                        }
                    } else {
                        if (val !== rule) return false;
                    }
                }
                return true;
            };

            let out = [];
            for (const [k, v] of Object.entries(root)) {
                if (typeof v === "object" && match(v, filter)) {
                    out.push({ key: k, value: v });
                }
            }

            if (options.sort) {
                const [field, order] = Object.entries(options.sort)[0];
                out.sort((a, b) => {
                    const valA = a.value[field];
                    const valB = b.value[field];
                    if (valA < valB) return order === 1 ? -1 : 1;
                    if (valA > valB) return order === 1 ? 1 : -1;
                    return 0;
                });
            }

            if (options.skip) {
                out = out.slice(options.skip);
            }

            if (options.limit) {
                out = out.slice(0, options.limit);
            }

            return out;
        });
    }

    async expire(key, ttlMs) {
        return this._mutex.run(async () => {
            if (typeof ttlMs === "number" && ttlMs > 0) {
                this._expires[key] = Date.now() + ttlMs;
            } else delete this._expires[key];
            this._scheduleSave();
            return true;
        });
    }

    async ttl(key) {
        return this._mutex.run(async () => {
            const exp = this._expires[key];
            if (typeof exp !== "number") return -1;
            return Math.max(0, exp - Date.now());
        });
    }

    async backup(destPath) {
        return this._mutex.run(async () => {
            const out = {
                data: this._data,
                expires: this._expires,
                version: 1,
                createdAt: new Date().toISOString(),
            };
            await fsp.writeFile(destPath, JSON.stringify(out, null, 2), "utf8");
            return destPath;
        });
    }

    async restore(srcPath) {
        return this._mutex.run(async () => {
            const raw = JSON.parse(await fsp.readFile(srcPath, "utf8"));
            this._data = raw.data || {};
            this._expires = raw.expires || {};
            this._rebuildIndex();
            this._emit("reset", { reason: "restore" });
            this._scheduleSave();
            return true;
        });
    }

    async export() {
        return this._mutex.run(async () => JSON.parse(JSON.stringify(this._data)));
    }

    async import(obj) {
        return this._mutex.run(async () => {
            if (!obj || typeof obj !== "object")
                throw new Error("import() expects object");
            this._data = JSON.parse(JSON.stringify(obj));
            this._expires = {};
            this._rebuildIndex();
            this._emit("reset", { reason: "import" });
            this._scheduleSave();
            return true;
        });
    }

    on(event, listener) {
        this._emitter.on(event, listener);
        return () => this._emitter.off(event, listener);
    }

    off(event, listener) {
        this._emitter.off(event, listener);
    }

    async transaction(fn) {
        return this._mutex.run(async () => {
            const snapshot = JSON.parse(JSON.stringify(this._data));
            const temp = new DarkDB({
                autoFile: false,
                separator: this.separator,
                format: this.format,
            });
            temp._data = JSON.parse(JSON.stringify(this._data));
            temp._expires = JSON.parse(JSON.stringify(this._expires));
            temp._indexManager = this._indexManager;

            try {
                await fn(temp);
                this._data = temp._data;
                this._expires = temp._expires;
                this._rebuildIndex();
                this._scheduleSave();
                this._emit("reset", { reason: "transaction" });
                return true;
            } catch (e) {
                this._data = snapshot;
                throw e;
            }
        });
    }
}

module.exports = DarkDB;