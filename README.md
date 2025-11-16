# elenora

Production‑ready, byte-based rolling file logger for Node.js.

Provides predictable file rotation, backup management and crash-safe flushing with zero runtime dependencies.

## Features

- **Byte-based rotation**: `maxSize` is enforced in bytes, not characters.
- **Rolling backups**: `app.log` + `Backup_0_app.log`, `Backup_1_app.log`, ...
- **Crash-safe flushing**: flushes logs on `exit`, `SIGINT`, `SIGTERM`.
- **Pluggable formatter**: custom format per log entry (string or Buffer).
- **Console integration**: wrap `console` or create dedicated logger instances.
- **`continueFromLast` option**: start with a clean file or continue on top of existing logs.

## Install

```bash
npm install elenora
```

## Quick Start

```js
const elenora = require('elenora');

// Wrap console and write to logs/app.log
elenora.connect(console, {
	filename: 'logs/app.log',
	maxSize: 5 * 1024 * 1024, // 5 MB
	backupCount: 3,
	continueFromLast: true,   // keep history across restarts
	interval: 500             // flush interval in ms
});

console.log('Server started');
console.info('Listening on port 3000');
console.warn('Spicy warning');
console.error('Something exploded');
```

This keeps up to `1 + backupCount` chunks on disk:

- `logs/app.log` – newest
- `logs/Backup_0_app.log` – slightly older
- `logs/Backup_1_app.log` – older

Each file is at most `maxSize` bytes. Oldest bytes are discarded first.

## API

### `connect(output, options)`

Monkey-patches an existing logger-like object (usually `console`).

```ts
connect(output: any, options?: {
	filename?: string;
	maxSize?: number;          // bytes, default 5 * 1024 * 1024
	backupCount?: number;      // default 0
	interval?: number;         // ms, default 1000
	timeZone?: string;         // passed to toLocaleString
	continueFromLast?: boolean;// default false
	Formatter?: (entry: LogEntry, dateString: string) => string | Buffer;
})
```

`LogEntry` shape:

```ts
interface LogEntry {
	level: 'LOG' | 'INFO' | 'WARN' | 'ERROR';
	message: string;
}
```

- `output`: anything with `log`, `info`, `warn`, `error`. `connect` wraps those methods but still calls the originals.
- `filename`: file path for the main log file. Backups live next to it.
- `maxSize`: max size per file in **bytes**.
- `backupCount`: how many backup files to keep.
- `interval`: how often logs are flushed from memory to disk.
- `continueFromLast`:
	- `false` (default): on process start, existing log file (if any) is deleted. Fresh file, fresh vibes.
	- `true`: keep existing file and continue appending + rotating.
- `Formatter`: format a single entry. If omitted, default plain text is used.

#### Default formatter

```text
[LEVEL] 16.11.2025 12:47:39 - message\n
```

### `newLog(options)`

Create a fresh logger object instead of patching `console`.

```js
const elenora = require('elenora');

const logger = elenora.newLog({
	filename: 'logs/api.log',
	maxSize: 2 * 1024 * 1024,
	backupCount: 2
});

logger.log('api online');
logger.info('GET /health ok');
logger.warn('rate limit close');
logger.error('db timeout');
```

Returned object exposes:

- `log(...args: any[])`
- `info(...args: any[])`
- `warn(...args: any[])`
- `error(...args: any[])`

## Custom Formatter

You own the log format. For example JSON lines:

```js
const elenora = require('elenora');

function jsonFormatter(entry, date) {
	return JSON.stringify({
		ts: date,
		level: entry.level,
		message: entry.message
	}) + '\n';
}

elenora.connect(console, {
	filename: 'logs/json.log',
	maxSize: 1024 * 1024,
	backupCount: 3,
	Formatter: jsonFormatter
});

console.log('hello json');
```

Or pure Buffer, if you want full control:

```js
function bufferFormatter(entry, date) {
	const line = `[${entry.level}] ${date} :: ${entry.message}\n`;
	return Buffer.from(line, 'utf8');
}
```

## Rotation Details

- Logs are buffered in memory and flushed every `interval` ms, or on process exit signals.
- On each flush:
	- Current file contents + new logs are merged into one big Buffer.
	- That Buffer is split into `maxSize`-sized chunks.
	- Only the newest `1 + backupCount` chunks are kept.
	- Each chunk is written fresh to its file:
		- newest → `app.log`
		- older → `Backup_0_app.log`, `Backup_1_app.log`, ...

No weird partial overwrites – every flush rewrites the chunk files cleanly.

## Implementation Notes

- Uses synchronous file I/O for simplicity and deterministic behavior.
- For high-throughput setups, keep `maxSize` at a reasonable size (in MBs, not GBs).
- No runtime dependencies; relies only on Node's built‑in `fs` and `path` modules.

## License

MIT-style. See repository for details.
