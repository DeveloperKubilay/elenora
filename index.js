const elenora = require('./module');

elenora.connect(console, {
    backupCount: 3
});

console.info("This is an info message.");