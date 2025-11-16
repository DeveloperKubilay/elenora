const fs = require('fs');
const path = require('path');

const exitcallbacks = [];

//To prevent logs from being lost during sudden crashes
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
        let maxSize = options.maxSize || 5 * 1024 * 1024; // Default 5 MB
        let filename = options.filename || "app.log"; // Default log file name
        let interval = options.interval || 1000; // Default flush interval 1 second
        let backupCount = options.backupCount || 0; // Default 0 backup files
        let continueFromLast = options.continueFromLast || false; // Default: do not continue across restarts
        output._logPath = path.resolve(filename);
        const dirPath = path.dirname(output._logPath);

        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        if (!continueFromLast && fs.existsSync(output._logPath)) {
            try {
                fs.unlinkSync(output._logPath);
            } catch { }
        }
        if (!fs.existsSync(output._logPath)) {
            fs.writeFileSync(output._logPath, '');
        }

        const waitlist = [];
        let ramlog = backupCount ? Buffer.alloc(0) : "";

        function flushLogs() {
            if (waitlist.length === 0) return;
            const date = new Date().toLocaleString('tr-TR', { timeZone: options.timeZone });
            const formatted = options.Formatter
                ? waitlist.map(entry => options.Formatter(entry, date))
                : waitlist.map(entry => `[${entry.level}] ${date} - ${entry.message}\n`);

            if (backupCount) {
                let currentBuf = Buffer.alloc(0);
                try {
                    if (fs.existsSync(output._logPath)) {
                        currentBuf = fs.readFileSync(output._logPath);
                    }
                } catch { }

                const newBuf = Buffer.isBuffer(formatted[0])
                    ? Buffer.concat(formatted.map(b => Buffer.isBuffer(b) ? b : Buffer.from(String(b))))
                    : Buffer.from(formatted.join(''), 'utf8');
                let combinedBuf = Buffer.concat([currentBuf, newBuf]);

                if (!combinedBuf.length) {
                    waitlist.length = 0;
                    return;
                }

                const chunks = [];
                for (let i = 0; i < combinedBuf.length; i += maxSize) {
                    chunks.push(combinedBuf.slice(i, i + maxSize));
                }

                const maxChunks = 1 + backupCount;
                if (chunks.length > maxChunks) {
                    chunks.splice(0, chunks.length - maxChunks);
                }

                const latestIndex = chunks.length - 1;

                for (let i = backupCount - 1; i >= 0; i--) {
                    const src = i === 0
                        ? output._logPath
                        : path.join(dirPath, `Backup_${i - 1}_${path.basename(output._logPath)}`);
                    const dest = path.join(dirPath, `Backup_${i}_${path.basename(output._logPath)}`);
                    if (fs.existsSync(src)) {
                        try {
                            fs.copyFileSync(src, dest);
                        } catch { }
                    }
                }

                fs.writeFileSync(output._logPath, chunks[latestIndex] || Buffer.alloc(0));

                let backupChunkIndex = latestIndex - 1;
                for (let i = 0; i < backupCount && backupChunkIndex >= 0; i++, backupChunkIndex--) {
                    const backupPath = path.join(dirPath, `Backup_${i}_${path.basename(output._logPath)}`);
                    fs.writeFileSync(backupPath, chunks[backupChunkIndex]);
                }
            } else {
                const newBuf = Buffer.isBuffer(formatted[0])
                    ? Buffer.concat(formatted.map(b => Buffer.isBuffer(b) ? b : Buffer.from(String(b))))
                    : Buffer.from(formatted.join(''), 'utf8');
                if (!Buffer.isBuffer(ramlog)) {
                    ramlog = Buffer.from(ramlog, 'utf8');
                }

                let combinedBuf = Buffer.concat([ramlog, newBuf]);
                if (combinedBuf.length > maxSize) {
                    const excess = combinedBuf.length - maxSize;
                    combinedBuf = combinedBuf.slice(excess);
                }
                ramlog = combinedBuf;
                fs.writeFileSync(output._logPath, combinedBuf);
            }
            waitlist.length = 0;
        }

        exitcallbacks.push(flushLogs);
        const flushInterval = setInterval(() => flushLogs(), interval);
        flushInterval.unref();


        const oldVersion = {
            log: output.log,
            info: output.info,
            warn: output.warn,
            error: output.error
        }

        output.log = function (...args) {
            waitlist.push({
                level: 'LOG',
                message: args.join(' ')
            });
            oldVersion.log.apply(output, args);
        }

        output.info = function (...args) {
            waitlist.push({
                level: 'INFO',
                message: args.join(' ')
            });
            oldVersion.info.apply(output, args);
        }

        output.warn = function (...args) {
            waitlist.push({
                level: 'WARN',
                message: args.join(' ')
            });
            oldVersion.warn.apply(output, args);
        }

        output.error = function (...args) {
            waitlist.push({
                level: 'ERROR',
                message: args.join(' ')
            });
            oldVersion.error.apply(output, args);
        }
    },
    newLog: function (...options) {
        let output = {};
        this.connect(output, ...options);
        return output;
    }
}