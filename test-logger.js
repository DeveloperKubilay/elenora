const path = require('path');
const fs = require('fs');
const loggerModule = require('./module');

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function run() {
    const logDir = __dirname;
    const filename = path.join(logDir, "debug", 'app.log');

    [filename,
        path.join(logDir, `Backup_0_app.log`),
        path.join(logDir, `Backup_1_app.log`),
        path.join(logDir, `Backup_2_app.log`)
    ].forEach(f => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
    });

    const out = console;
    loggerModule.connect(out, {
        filename,
        maxSize: 1024 * 4, // 2 KB
        backupCount: 3,
        interval: 200
    });

    for (let i = 0; i < 80; i++) {
        out.log('LINE', i.toString().padStart(3, '0'), 'x'.repeat(20));
        await sleep(10);
    }

    await sleep(1000);

    const files = [
        'app.log',
        'Backup_0_app.log',
        'Backup_1_app.log',
        'Backup_2_app.log'
    ];

    for (const f of files) {
        const p = path.join(logDir, f);
        if (fs.existsSync(p)) {
            const buf = fs.readFileSync(p);
            console.log(f, 'size=', buf.length);
            console.log('---', f, 'content start ---');
            console.log(buf.toString('utf8'));
            console.log('---', f, 'content end ---');
        } else {
            console.log(f, 'yok');
        }
    }
}

run().catch(err => {
    console.error('test error', err);
});
