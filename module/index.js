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
        output._logPath = path.resolve(filename);
        const dirPath = path.dirname(output._logPath);

        if (backupCount && fs.existsSync(output._logPath) && !fs.lstatSync(output._logPath).isDirectory()) {
            try {
                const backupPath = path.join(dirPath, `Backup_${path.basename(output._logPath)}`);
                fs.renameSync(output._logPath, backupPath);
            } catch { }
        }
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            if (backupCount) fs.readdirSync(dirPath).forEach(file => {
                if (/^Backup_\d+\./.test(file) && file.includes(path.basename(output._logPath))) {
                    fs.unlinkSync(path.join(dirPath, file));
                }
            });
        }
        if (!fs.existsSync(output._logPath)) {
            fs.writeFileSync(output._logPath, '');
        }

        const waitlist = [];
        let ramlog = backupCount ? 0 : "";

        function flushLogs() {
            if (waitlist.length === 0) return;
            const date = new Date().toLocaleString('tr-TR', { timeZone: options.timeZone });
            const newLogs = options?.Formatter ? options.Formatter(waitlist) :
                waitlist.map(entry => `[${entry.level}] ${date} - ${entry.message}\n`)

            if (backupCount) {
                if (ramlog + newLogs.length > maxSize) {
                    if (newLogs.length > maxSize * backupCount) {
                        newLogs.splice(0, newLogs.length - maxSize * backupCount);
                    }

                    if(ramlog < maxSize){
                        const chunk = newLogs.splice(0, maxSize - ramlog);
                        fs.appendFileSync(output._logPath, chunk.join(''));
                        ramlog += chunk.length;
                    }

                    const myObj = Object.fromEntries([...Array(backupCount)].map((_, i) => [i, []]));
                    

                    for (let i = 0; i < ((ramlog + newLogs.length) / maxSize) + 1; i++) {
                        if (myObj[i].length == maxSize) myObj[i] = [];
                        const chunk = newLogs.splice(0, maxSize - ramlog);
                        myObj[i].push(chunk);
                        ramlog = 0;
                    }

                    const chunksize = Object.values(myObj).filter(arr => arr.length > 0).length;
                    if (chunksize != backupCount)
                        //5 chunk limit 4 chunk yazıcam bene 3 backup var
                        //app.log > Backup_5.log
                        //5 chunk limit 3 chunk yazıcam bene 2 backup var
                        //app.log > Backup_4.log
                        //Backup_4 > Backup_5.log
                        //5 chunk limit 2 chunk yazıcam bene 1 backup var
                        //app.log > Backup_3.log
                        //Backup_3 > Backup_4.log
                        //5 chunk limit 2 chunk yazıcam bene 4 backup var
                        //Backup 4 > Backup_5.log
                        //Backup 3 > Backup_4.log
                        //Backup 0 > Backup_3.log
                        //app.log > Backup_2.log

                        for (let i = backupCount - chunksize + 1; i >= 0; i--) {
                            const src = i === 0 ? output._logPath : path.join(dirPath, `Backup_${i}_${path.basename(output._logPath)}`);



                        }

                }

            } else {
                if (ramlog.length + newLogs.length > maxSize) {
                    ramlog = ramlog.slice(newLogs.length);
                }
                ramlog += newLogs;
                fs.writeFileSync(output._logPath, ramlog);
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