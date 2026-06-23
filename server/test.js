const elenora = require('elenora');

elenora.connect(console, {
    backupCount: 3,
    remoteServer: {
        url: '127.0.0.1:8081',
        tag: 'backend/server-1',
        password: 'test',
        metadata: metadata,
        metadataInterval: 100
    }
});

function metadata(){
    return {
        cpu:1,
        memory:Math.floor(Math.random() * 101),
    }
}

console.info("This is an info message from the client!");

setInterval(() => {
    console.log("Heartbeat... random value: " + Math.random().toFixed(4));
}, 2000);
