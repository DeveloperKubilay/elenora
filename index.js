const elenora = require('./module');

elenora.connect(console, {
    filename: 'logs/app.log',
    maxSize: 1024, // 1 KB
    backupCount: 3
});

for(let i = 0; i < 100000; i++) {
    console.log("This is a log message.");
}

console.info("This is an info message.");