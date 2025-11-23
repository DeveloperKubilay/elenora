const elenora = require('./module');

elenora.connect(console, {
    maxSize: 1024, // 1 KB
    backupCount: 3
});
/*
for(let i = 0; i < 100000; i++) {
    console.log("This is a log message.");
}
*/
function test(){
    console.log("Test function log message.");
}

console.info("This is an info message.");
console.warn(1)
console.error({ error: "This is an error message." });
console.log([1,2,3,4,5],test);
console.info("This is an info message."*4);