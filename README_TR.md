# 🔥elenora 🔥

**Production ortamına hazır**, byte tabanlı rolling file **logger** Node.js için.

Tahmin edilebilir dosya rotasyonu, yedek yönetimi ve crash-safe flushing sağlar, sıfır runtime bağımlılığı ile.

![](https://github.com/DeveloperKubilay/elenora/blob/main/example.gif?raw=true)

## Hızlı Başlangıç

```js
const elenora = require('elenora');

// console'u sar ve logs/app.log'a yaz
elenora.connect(console, {
	filename: 'logs/app.log',
	maxSize: 5 * 1024 * 1024, // 5 MB
	backupCount: 3,		  //max: 5MB*3 dosya
	continueFromLast: true,   // restart'ta history kalsın
	interval: 1000            // flush süresi (ms)
});

console.log('Sunucu başlatıldı');
console.info('3000 portu dinleniyor');
console.warn('Baharatlı uyarı');
console.error('Bir şey patladı');
```

## Kurulum

```bash
npm install elenora
```


## Özellikler

- **Byte bazlı rotation**: `maxSize` byte cinsinden uygulanır, karakter değil.
- **Yedekli dosyalar**: `app.log` + `Backup_0_app.log`, `Backup_1_app.log`, ...
- **Crash-safe flushing**: `exit`, `SIGINT`, `SIGTERM` sinyallerinde logları diske boşaltır.
- **Takılabilir formatter**: her log kaydı için özel format (string veya Buffer).
- **Console entegrasyonu**: `console`'u sar veya bağımsız logger örnekleri oluştur.
- **`continueFromLast` seçeneği**: temiz dosyayla başla veya mevcut logların üzerine devam et.
- **Remote server desteği**: logları merkezi sunucuya akıt, metadata takibiyle.


Diskte en fazla `1 + backupCount` parça tutulur:

- `logs/app.log` – en yeni
- `logs/Backup_0_app.log` – biraz daha eski
- `logs/Backup_1_app.log` – daha eski

Her dosya en fazla `maxSize` byte. En eski byte'lar önce gider.

## API

### `connect(output, options)`

Var olan bir logger benzeri objeyi (genelde `console`) monkey-patch'ler.

```ts
connect(output: any, options?: {
	filename?: string;
	maxSize?: number;          // byte, varsayılan 5 * 1024 * 1024
	backupCount?: number;      // varsayılan 0
	interval?: number;         // ms, varsayılan 1000
	timeZone?: string;         // toLocaleString'e aktarılır
	continueFromLast?: boolean;// varsayılan false
	Formatter?: (entry: LogEntry, dateString: string) => string | Buffer;
	timestamp: boolean;
})
```

`LogEntry` şekli:

```ts
interface LogEntry {
	level: 'LOG' | 'INFO' | 'WARN' | 'ERROR';
	message: string;
}
```

- `output`: `log`, `info`, `warn`, `error` metodları olan herhangi bir obje. `connect` bu metodları sarar ama orijinallerini de çağırır.
- `filename`: ana log dosyası yolu. Yedekler aynı klasörde durur.
- `maxSize`: dosya başına **byte** cinsinden üst sınır.
- `backupCount`: kaç adet yedek dosya tutulacağı.
- `interval`: logların hafızadan diske ne sıklıkta yazılacağı (ms).
- `continueFromLast`:
	- `false` (varsayılan): proses başlangıcında mevcut log dosyası (varsa) silinir. Temiz dosya, taze başlangıç.
	- `true`: mevcut dosyayı koru ve üzerine ekleme + rotasyon yapmaya devam et.
- `Formatter`: tek bir girdiyi formatlar. Atlanırsa varsayılan düz metin kullanılır.

#### Varsayılan formatter

```text
[LEVEL] 16.11.2025 12:47:39 - message\n
```

### `newLog(options)`

`console`'a dokunmadan yeni bir logger nesnesi oluştur.

```js
const elenora = require('elenora');

const logger = elenora.newLog({
	filename: 'logs/api.log',
	maxSize: 2 * 1024 * 1024,
	backupCount: 2
});

logger.log('api çevrimiçi');
logger.info('GET /health ok');
logger.warn('rate limit yaklaştı');
logger.error('db timeout');
```

Dönen nesne şunları içerir:

- `log(...args: any[])`
- `info(...args: any[])`
- `warn(...args: any[])`
- `error(...args: any[])`

## Custom Formatter

Format tamamen senin elinde. Örneğin JSON satırları:

```js
const elenora = require('elenora');

function jsonFormatter(entry, date) {
	return JSON.stringify({
		ts: date,
		level: entry.level,
		message: entry.message
	}) + '\n';
}

elenora.connect(console, {
	filename: 'logs/json.log',
	maxSize: 1024 * 1024,
	backupCount: 3,
	Formatter: jsonFormatter
});

console.log('hello json');
```

Ya da tam kontrol için Buffer:

```js
function bufferFormatter(entry, date) {
	const line = `[${entry.level}] ${date} :: ${entry.message}\n`;
	return Buffer.from(line, 'utf8');
}
```

## Remote Server

Logları merkezi bir sunucuya akıtarak birden fazla servisi tek yerden izleyebilirsin. Config'e `remoteServer` eklemen yeterli:

```js
const elenora = require('elenora');

elenora.connect(console, {
    backupCount: 3,
    remoteServer: {
        url: '127.0.0.1:8081',
        tag: 'backend/server-1',
        password: 'test',
        metadata: () => ({
            cpu: process.cpuUsage(),
            memory: process.memoryUsage().heapUsed
        }),
        metadataInterval: 5000
    }
});

console.log('Servis başlatıldı');
```

- `url`: sunucu adresi (TCP)
- `tag`: bu servisi dashboard'da tanımlar
- `password`: kimlik doğrulama token'ı
- `metadata`: özel metrikler döndüren fonksiyon, `metadataInterval` ms'de bir gönderilir

Server kodu GitHub'da `/server` klasöründe. `node server/index.js` ile çalıştır, `http://localhost:8080` adresinden web dashboard'a ulaş.

## Rotation Detayları

- Loglar önce hafızada birikir, her `interval` ms'de bir veya proses çıkış sinyallerinde diske yazılır.
- Her flush'ta:
	- Mevcut dosya içeriği + yeni loglar tek bir büyük Buffer'da birleştirilir.
	- Buffer `maxSize` boyutunda parçalara bölünür.
	- Sadece en yeni `1 + backupCount` parça tutulur.
	- Her parça dosyasına baştan yazılır:
		- en yeni → `app.log`
		- daha eski → `Backup_0_app.log`, `Backup_1_app.log`, ...

Garip kısmi yazmalar olmaz – her flush chunk dosyalarını temizce yeniden yazar.

## Uygulama Notları

- Basitlik ve deterministik davranış için senkron dosya I/O kullanır.
- Yüksek trafikli sistemlerde `maxSize` değerini makul tutun (MB seviyesinde, GB değil).
- Runtime bağımlılığı yoktur; sadece Node'un yerleşik `fs` ve `path` modüllerini kullanır.

## Lisans

MIT tarzı. Detaylar için repository'ye bakın.
