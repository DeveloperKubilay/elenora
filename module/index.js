const fs = require('fs');
const path = require('path');
const net = require('net');

const exitcallbacks = [];

process.on('exit', (code) => {
    exitcallbacks.forEach(cb => cb());
});

process.on('SIGTERM', () => {
    exitcallbacks.forEach(cb => cb());
    process.exit(0);
});

process.on('SIGINT', () => {
    exitcallbacks.forEach(cb => cb());
    process.exit(0);
});

module.exports = {
    connect: function (output, options = {}) {
        let backupCount = Number.isInteger(options.backupCount) ? options.backupCount : 0; // Default 0 backup files
        const effectiveMaxSize = (typeof options.maxSize !== 'undefined') ? options.maxSize : 5 * 1024 * 1024; // Default 5 MB; 0 means "no limit"
        let filename = backupCount > 0 && !options.filename ? "logs/app.log" : options.filename || "app.log"; // Default log file name
        let interval = options.interval || 5000; // Default flush interval 5 seconds
        let continueFromLast = options.continueFromLast || false; // Default: do not continue across restarts
        const includeTimestamp = options.timestamp !== false;
        output._logPath = path.resolve(filename);
        const dirPath = path.dirname(output._logPath);
        const formatEntry = options.Formatter
            ? (entry, date) => options.Formatter(entry, date)
            : includeTimestamp
                ? (entry, date) => `[${entry.level}] ${date} - ${entry.message}\n`
                : (entry) => `[${entry.level}] ${entry.message}\n`;

        let isRemote = false;
        let remoteSocket = null;

        if (options.remoteServer && options.remoteServer.url) {
            isRemote = true;
            function connectRemote() {
                const parts = options.remoteServer.url.split(':');
                const host = parts[0] || '127.0.0.1';
                const port = parts[1] || 8081;
                remoteSocket = new net.Socket();
                remoteSocket.connect(port, host, () => {
                    const authStr = `auth|${options.remoteServer.password || ''}|${options.remoteServer.tag || 'unknown'}\n`;
                    remoteSocket.write(authStr);
                });
                remoteSocket.on('error', (err) => {
                    console.error("Elenora Remote Logger Error:", err.message);
                });
                remoteSocket.on('close', () => {
                    setTimeout(connectRemote, 5000);
                });
            }
            connectRemote();

            if (typeof options.remoteServer.metadata === 'function') {
                const intervalTime = options.remoteServer.metadataInterval || 5000;
                const metaInterval = setInterval(async () => {
                    try {
                        const metaData = await options.remoteServer.metadata();
                        if (remoteSocket && !remoteSocket.destroyed) {
                            remoteSocket.write(`meta|${JSON.stringify(metaData)}\n`);
                        }
                    } catch (e) {}
                }, intervalTime);
                metaInterval.unref();
            }
        } else {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }

            // Initial cleanup if not continuing from last session
            if (!continueFromLast) {
                if (fs.existsSync(output._logPath)) {
                    try {
                        fs.unlinkSync(output._logPath);
                    } catch { }
                }
                if (backupCount > 0) {
                    for (let i = 0; i < backupCount; i++) {
                        const backupPath = path.join(dirPath, `Backup_${i}_${path.basename(output._logPath)}`);
                        if (fs.existsSync(backupPath)) {
                            try {
                                fs.unlinkSync(backupPath);
                            } catch { }
                        }
                    }
                }
            }
        }

        let stream;
        let currentSize = 0;
        const waitlist = [];

        function openStream() {
            if (isRemote) return;
            if (fs.existsSync(output._logPath)) {
                try {
                    const stats = fs.statSync(output._logPath);
                    currentSize = stats.size;
                } catch (e) {
                    currentSize = 0;
                }
            } else {
                currentSize = 0;
            }
            
            stream = fs.createWriteStream(output._logPath, { flags: 'a' });
            stream.on('error', (err) => {
                console.error("Elenora Logger Stream Error:", err);
            });
        }

        // Initialize stream
        openStream();

        function rotateLogs() {
            if (isRemote) return;
            if (stream) {
                stream.destroy();
                stream = null;
            }

            const baseName = path.basename(output._logPath);

            // Shift backups: Backup_N-1 -> Backup_N
            for (let i = backupCount - 1; i > 0; i--) {
                const src = path.join(dirPath, `Backup_${i - 1}_${baseName}`);
                const dest = path.join(dirPath, `Backup_${i}_${baseName}`);
                if (fs.existsSync(src)) {
                    try {
                        fs.renameSync(src, dest);
                    } catch (e) { }
                }
            }

            // Current log -> Backup_0
            if (backupCount > 0) {
                const firstBackup = path.join(dirPath, `Backup_0_${baseName}`);
                if (fs.existsSync(output._logPath)) {
                    try {
                        fs.renameSync(output._logPath, firstBackup);
                    } catch (e) { }
                }
            } else {
                // If no backups kept, just delete current log to start fresh
                if (fs.existsSync(output._logPath)) {
                    try {
                        fs.unlinkSync(output._logPath);
                    } catch (e) { }
                }
            }

            openStream();
        }

        function flushLogs(isSync = false) {
            if (waitlist.length === 0) return;

            const date = includeTimestamp ? new Date().toLocaleString('tr-TR', { timeZone: options.timeZone }) : undefined;
            const formatted = waitlist.map(entry => formatEntry(entry, date));

            const dataBuf = Buffer.concat(formatted.map(item => Buffer.isBuffer(item) ? item : Buffer.from(String(item))));

            if (dataBuf.length === 0) return;

            if (isRemote) {
                if (remoteSocket && !remoteSocket.destroyed) {
                    remoteSocket.write(dataBuf);
                }
                waitlist.length = 0;
                return;
            }

            let offset = 0;
            while (offset < dataBuf.length) {
                if (effectiveMaxSize > 0 && currentSize >= effectiveMaxSize) {
                    rotateLogs();
                }

                const remainingSpace = effectiveMaxSize > 0 ? effectiveMaxSize - currentSize : dataBuf.length - offset;
                let chunkSize = effectiveMaxSize > 0 ? Math.min(remainingSpace, dataBuf.length - offset) : dataBuf.length - offset;
                
                if (chunkSize <= 0) {
                    rotateLogs();
                    chunkSize = effectiveMaxSize > 0 ? Math.min(effectiveMaxSize, dataBuf.length - offset) : dataBuf.length - offset;
                }

                const chunk = dataBuf.slice(offset, offset + chunkSize);

                if (isSync) {
                    if (stream) {
                        stream.destroy();
                        stream = null;
                    }
                    try {
                        fs.appendFileSync(output._logPath, chunk);
                    } catch (e) {
                        console.error("Elenora Logger Sync Write Error:", e);
                    }
                } else {
                    if (!stream || stream.destroyed || stream.closed) {
                        openStream();
                    }
                    stream.write(chunk);
                }

                currentSize += chunk.length;
                offset += chunk.length;
            }
            
            waitlist.length = 0;
        }

        exitcallbacks.push(() => {
            flushLogs(true);
            if (stream) stream.destroy();
        });

        const flushInterval = setInterval(flushLogs, interval);
        flushInterval.unref();

        const levelMap = {
            log: 'LOG',
            info: 'INFO',
            warn: 'WARN',
            error: 'ERROR',
            slientlog: 'SLIENTLOG',
            slienterror: 'SLIENTERROR',
            slientwarn: 'SLIENTWARN',
            debug: 'DEBUG',
            warning: 'WARNING',
            alert: 'ALERT',
            success: 'SUCCESS',
            issues: "ISSUES"
        };

        const oldFunctions = {
            log: output.log,
            info: output.info,
            warn: output.warn,
            error: output.error
        };

        Object.keys(levelMap).forEach(level => {
            if (oldFunctions[level]) {
                output[level] = function (...args) {
                    const formattedArgs = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg);
                    waitlist.push({ level: levelMap[level], message: formattedArgs.join(' ') });
                    oldFunctions[level].apply(output, args);
                };
            } else {
                output[level] = function (...args) {
                    const formattedArgs = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg);
                    waitlist.push({ level: levelMap[level], message: formattedArgs.join(' ') });
                };
            }
        });
    },
    newLog: function (...options) {
        let output = {};
        this.connect(output, ...options);
        return output;
    }
}