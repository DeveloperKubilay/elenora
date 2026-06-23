const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const token = "test";
const TCP_PORT = 8081;
const HTTP_PORT = 8080;
const LOGS_DIR = path.join(__dirname, 'logs');
const META_DIR = path.join(__dirname, 'logs_meta');

[LOGS_DIR, META_DIR].forEach(dir => !fs.existsSync(dir) && fs.mkdirSync(dir, { recursive: true }));

const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(100);

const META_FLUSH_INTERVAL = 10000;
const metaWriteBuffer = new Map();

function bufferMetaLine(tag, lineObj) {
    const metaPath = path.join(META_DIR, tag + '.jsonl');
    const dirPath = path.dirname(metaPath);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    if (!metaWriteBuffer.has(metaPath)) metaWriteBuffer.set(metaPath, []);
    metaWriteBuffer.get(metaPath).push(JSON.stringify(lineObj));
}

function flushMetaBuffer() {
    if (metaWriteBuffer.size === 0) return;
    metaWriteBuffer.forEach((lines, metaPath) => {
        if (lines.length === 0) return;
        const chunk = lines.join('\n') + '\n';
        metaWriteBuffer.set(metaPath, []);
        fs.appendFile(metaPath, chunk, (err) => err && console.error('[META] Flush error:', err.message));
    });
}

const metaFlushTimer = setInterval(flushMetaBuffer, META_FLUSH_INTERVAL);
metaFlushTimer.unref();

process.on('exit', flushMetaBuffer);
process.on('SIGTERM', () => { flushMetaBuffer(); process.exit(0); });
process.on('SIGINT',  () => { flushMetaBuffer(); process.exit(0); });

const tcpServer = net.createServer((socket) => {
    let isAuthenticated = false;
    let clientTag = 'unknown';
    let buffer = '';

    socket.on('data', (data) => {
        buffer += data.toString();
        let newlineIdx;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIdx).trim();
            buffer = buffer.slice(newlineIdx + 1);

            if (!isAuthenticated) {
                const parts = line.split('|');
                if (parts[0] === 'auth' && parts[1] === token) {
                    isAuthenticated = true;
                    clientTag = parts[2] || 'unknown';
                    clientTag = clientTag.replace(/\.\./g, '').replace(/^[\/\\]+/, '');
                    console.log(`[TCP] Client authenticated. Tag: ${clientTag}`);
                } else {
                    console.error('[TCP] Invalid authentication attempt.');
                    socket.write('ERR:Invalid token.\n');
                    socket.destroy();
                    break;
                }
            } else {
                if (line.length > 0) processLogsLine(clientTag, line);
            }
        }
    });

    socket.on('error', (err) => console.error(`[TCP] Socket error for tag ${clientTag}:`, err.message));
    socket.on('end', () => console.log(`[TCP] Client disconnected. Tag: ${clientTag}`));
});

function processLogsLine(tag, line) {
    if (line.startsWith('meta|')) {
        try {
            const metaJson = line.substring(5);
            const metaData = JSON.parse(metaJson);
            metaData.timestamp = Date.now();
            logEmitter.emit(`meta:${tag}`, metaJson);
            bufferMetaLine(tag, metaData);
        } catch(e) {}
    } else {
        const match = line.match(/^\[([A-Z]+)\]/);
        if (match) {
            const levelStr = match[1];
            const metric = { timestamp: Date.now() };
            if (['ERROR', 'ALERT', 'SLIENTERROR'].includes(levelStr)) metric.error_count = 1;
            else if (['WARN', 'WARNING', 'SLIENTWARN'].includes(levelStr)) metric.warn_count = 1;
            else if (['SUCCESS'].includes(levelStr)) metric.success_count = 1;
            else metric.info_count = 1;
            bufferMetaLine(tag, metric);
        }

        const safeTagPath = path.join(LOGS_DIR, tag + '.log');
        const dirPath = path.dirname(safeTagPath);
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
        fs.appendFile(safeTagPath, line + '\n', () => {});
        logEmitter.emit(`log:${tag}`, line);
    }
}

tcpServer.listen(TCP_PORT, () => console.log(`[TCP] Log Receiver listening on port ${TCP_PORT}`));

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg'
};

const httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    let pathname = parsedUrl.pathname;

    const isAuth = () => {
        const cookieHeader = req.headers.cookie || '';
        const match = cookieHeader.match(/Elenora-Auth=([^;]+)/);
        return match && match[1] === token;
    };

    if (pathname === '/api/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (data.password === token) {
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Set-Cookie': `Elenora-Auth=${token}; Path=/; Max-Age=2592000`
                    });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false }));
                }
            } catch(e) {
                res.writeHead(400); res.end();
            }
        });
        return;
    }

    if (pathname.startsWith('/api/') && pathname !== '/api/login') {
        if (!isAuth()) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Unauthorized' }));
        }
    }

    if (pathname === '/api/logs/tree') {
        const getTree = (dir, basePath = '') => {
            let results = [];
            if (!fs.existsSync(dir)) return results;
            const list = fs.readdirSync(dir);
            list.forEach((file) => {
                const fullPath = path.resolve(dir, file);
                const stat = fs.statSync(fullPath);
                if (stat && stat.isDirectory()) {
                    results.push({
                        type: 'directory',
                        name: path.basename(file),
                        children: getTree(fullPath, path.join(basePath, path.basename(file)).replace(/\\/g, '/'))
                    });
                } else if (file.endsWith('.log')) {
                    const name = path.basename(file, '.log');
                    results.push({
                        type: 'file',
                        name: name,
                        tag: path.join(basePath, name).replace(/\\/g, '/')
                    });
                }
            });
            return results;
        };

        try {
            const tree = getTree(LOGS_DIR);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(tree));
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    if (pathname === '/api/logs/history') {
        const tag = parsedUrl.searchParams.get('tag');
        if (!tag) {
            res.writeHead(400);
            return res.end('Missing tag');
        }
        const safeTagPath = path.join(LOGS_DIR, tag.replace(/\.\./g, '') + '.log');
        if (fs.existsSync(safeTagPath)) {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            fs.createReadStream(safeTagPath).pipe(res);
        } else {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('');
        }
        return;
    }

    if (pathname === '/api/logs/metrics') {
        const tag = parsedUrl.searchParams.get('tag');
        if (!tag) {
            res.writeHead(400);
            return res.end('Missing tag');
        }
        const safeTagPath = path.join(META_DIR, tag.replace(/\.\./g, '') + '.jsonl');
        if (fs.existsSync(safeTagPath)) {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            fs.createReadStream(safeTagPath).pipe(res);
        } else {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('');
        }
        return;
    }

    if (pathname === '/api/logs/stream') {
        const tag = parsedUrl.searchParams.get('tag');
        if (!tag) {
            res.writeHead(400);
            return res.end('Missing tag');
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        res.write(': connected\n\n');

        const logListener = (data) => {
            const lines = data.toString().split('\n');
            for(let i = 0; i < lines.length; i++) {
                if (lines[i].length > 0 || i < lines.length - 1) {
                    res.write(`event: log\ndata: ${JSON.stringify(lines[i])}\n\n`);
                }
            }
        };

        const metaListener = (data) => res.write(`event: meta\ndata: ${data}\n\n`);

        const eventLogName = `log:${tag}`;
        const eventMetaName = `meta:${tag}`;

        logEmitter.on(eventLogName, logListener);
        logEmitter.on(eventMetaName, metaListener);

        req.on('close', () => {
            logEmitter.off(eventLogName, logListener);
            logEmitter.off(eventMetaName, metaListener);
        });
        return;
    }

    if (pathname === '/') pathname = '/index.html';

    if (pathname === '/index.html' && !isAuth()) {
        res.writeHead(302, { 'Location': '/login.html' });
        return res.end();
    }

    const ext = path.extname(pathname);
    const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(__dirname, 'public', safePath);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
        res.end(data);
    });
});

httpServer.listen(HTTP_PORT, () => console.log(`[HTTP] Web Dashboard listening on port ${HTTP_PORT}`));
