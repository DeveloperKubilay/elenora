const elenora = require('./module');

elenora.connect(console, {
    backupCount: 3,
    timestamp: false
});

console.info("This is an info message.");