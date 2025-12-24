# DarkDB V3.4.0

A **lightweight, versatile, and high-performance database** for Node.js.  
Supports multiple data formats, advanced query engine, transactions, TTL, and event system.  
Designed for **simplicity, performance, and scalability**.

---

## ✨ Features
- Store data in **JSON, YAML, TOML OR BINARY** files.
- **Advanced search** with full indexing.
- **Query engine** with operators:
  - `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`
  - `$in`, `$nin`, `$regex`
  - `$and`, `$or`, `$not`
- **Transaction support** for atomic multi-step operations.
- Nested path access with `.` separator (e.g., `user.profile.age`).
- Core operations: `set`, `get`, `delete`, `has`.
- Array operations: `push`, `unpush`.
- Number operations: `add`, `remove`, `incr`, `decr`.
- Bulk operations: `all`, `deleteAll`.
- TTL (time-to-live) with automatic expiry.
- Backup & restore support.
- Event system (listen to `set`, `delete`, `reset`, `change`).
- Journaling & crash-safe saves.
- Debounced writes for performance.
- Sharding support for very large datasets.
- **Configurable Indexing** (index any field).
- **Schema Validation** (enforce types).
- **Hooks/Middleware** (`pre` and `post` events).
- **Advanced Querying** (sort, limit, skip).

---

## 📦 Installation

```bash
npm install darkdb
```

# DarkDB Benchmark Results

| Test              | Atomic | Iterations | Elapsed (ms) | Ops/sec     |
|-------------------|--------|------------|--------------|-------------|
| SET ops           | true   | 10000      | 41.63        | 240,238.51  |
| SET ops           | false  | 10000      | 18.57        | 538,578.37  |
| GET ops           | true   | 10000      | 18.54        | 539,249.26  |
| GET ops           | false  | 10000      | 12.43        | 804,439.92  |
| DELETE ops        | true   | 10000      | 14.68        | 681,426.36  |
| DELETE ops        | false  | 10000      | 14.89        | 671,456.39  |
| INCR ops          | true   | 10000      | 17.76        | 562,936.28  |
| INCR ops          | false  | 10000      | 9.28         | 1,078,132.24|
| TRANSACTION ops   | true   | 1000       | 11.57        | 86,405.03   |
| TRANSACTION ops   | false  | 1000       | 6.94         | 144,048.63  |


---

## 🚀 Usage

### Basic Operations
```js
const DarkDB = require("darkdb");

const db = new DarkDB({
  name: "darkdb",
  separator: ".",
  autoFile: true,
  jsonSpaces: 4
});

// Basic set & get
await db.set("user.name", "Alice");
console.log(await db.get("user.name")); // "Alice"

// Delete value
await db.delete("user.name");

// Check existence
console.log(await db.has("user")); // true
```

### Advanced Features
```js
// Store data in YAML format
const yamlDb = new DarkDB({
  name: "yaml_db",
  format: "yaml"
});

// Use search with indexing
await db.set("documents.1", {
  title: "A Guide to Node.js",
  description: "Learn how to build powerful Node.js applications.",
});

await db.set("documents.2", {
  title: "Introduction to JavaScript",
  description: "A beginner's guide to JavaScript programming.",
});

const results = await db.search("Node.js");
console.log(results);

// TTL (expires after 5 seconds)
await db.set("session.token", "abc123", { ttlMs: 5000 });

// Event system
db.on("set", ({ key, value }) => {
  console.log(`[EVENT] Key set: ${key} = ${value}`);
});

// Configurable Indexing
const dbIndexed = new DarkDB({
  name: "indexed_db",
  indexFields: ["name", "role", "email"]
});

// Schema Validation
const dbSchema = new DarkDB({
  name: "schema_db",
  schema: {
    name: String,
    age: Number,
    active: Boolean
  }
});

// Hooks
db.pre("set", async ({ key, value }) => {
  console.log(`Saving ${key}...`);
});
db.post("delete", async ({ key }) => {
  console.log(`${key} deleted.`);
});
```
```js
// Store data in TOML format
const tomlDb = new DarkDB({
  name: "toml_db",
  format: "toml"
});

// Use search with indexing
await tomlDb.set("documents.1", {
  title: "A Guide to Node.js",
  description: "Learn how to build powerful Node.js applications.",
});

await tomlDb.set("documents.2", {
  title: "Introduction to JavaScript",
  description: "A beginner's guide to JavaScript programming.",
});

const tomlResults = await tomlDb.search("JavaScript");
console.log("[TOML Search Results]", tomlResults);

// TTL (expires after 3 seconds)
await tomlDb.set("session.token", "xyz987", { ttlMs: 3000 });

// Event system
tomlDb.on("set", ({ key, value }) => {
  console.log(`[TOML EVENT] Key set: ${key} = ${value}`);
});

```
```js
// Store data in Binary format
const binaryDb = new DarkDB({
  name: "binary_db",
  format: "binary"
});

// Use search with indexing
await binaryDb.set("documents.1", {
  title: "Binary Storage Example",
  description: "Data is stored in a compact binary format.",
});

await binaryDb.set("documents.2", {
  title: "Another Document",
  description: "Binary files are efficient for large datasets.",
});

const binaryResults = await binaryDb.search("Binary");
console.log("[Binary Search Results]", binaryResults);

// TTL (expires after 10 seconds)
await binaryDb.set("session.token", "bin123", { ttlMs: 10000 });

// Event system
binaryDb.on("set", ({ key, value }) => {
  console.log(`[BINARY EVENT] Key set: ${key} = ${value}`);
});
```
### Transactions
```js
await db.transaction(async (tx) => {
  await tx.set("balance", 100);
  await tx.decr("balance");
});
```

### Query Engine
```js
await db.set("users.1", { name: "Alice", age: 25 });
await db.set("users.2", { name: "Bob", age: 30 });

// Basic Query
const adults = await db.query("users", { age: { $gte: 18 } });

// Advanced Query (Sort, Limit, Skip)
const sorted = await db.query("users", { age: { $gte: 18 } }, {
  sort: { age: -1 }, // Descending
  limit: 10,
  skip: 0
});
```

---

## 🛠 Options

| Option       | Default   | Description |
|--------------|-----------|-------------|
| `name`       | `darkdb` | Database file name |
| `dir`        | `.`      | Directory to store files |
| `format`     | `json`   | File format: **`json` `yaml` `toml` or `binary` ** |
| `separator`  | `.`      | Separator for nested keys |
| `autoFile`   | `true`   | Save automatically to file |
| `jsonSpaces` | `4`      | Pretty JSON formatting |
| `debounceMs` | `25`     | Debounce time for file saves in ms |
| `atomic`     | `true`   | Use atomic file writes for crash safety |
| `shard`      | `false`  | Enable sharding for large datasets |
| `indexFields`| `['title', 'description']` | Fields to index |
| `schema`     | `null`   | Schema definition object |

---

## 🔑 API

- `set(path, value, options?)`
- `get(path, defaultValue?)`
- `delete(path)`
- `has(path)`
- `all()`
- `deleteAll()`
- `push(path, value)`
- `unpush(path, value)`
- `add(path, number)`
- `remove(path, number)`
- `incr(path)`
- `decr(path)`
- `keys(path?)`
- `values(path?)`
- `entries(path?)`
- `find(path, predicate)`
- `search(query)`
- `query(keyPrefix, filter)`
- `expire(path, ttlMs)`
- `ttl(path)`
- `backup(filePath)`
- `restore(filePath)`
- `export()`
- `import(obj)`
- `transaction(fn)`
- `on(event, callback)`
- `off(event, listener)`
- `pre(action, callback)`
- `post(action, callback)`

---

## 📌 Events
- `set`
- `delete`
- `reset`
- `change`
