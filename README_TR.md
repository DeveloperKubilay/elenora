# elenora

Node.js projeleri için, production ortamına uygun, byte tabanlı bir loglama ve dosya döndürme (rolling file) kütüphanesi.

Amacı net: logları belirlediğin boyut sınırında tutmak, yedek dosyaları yönetmek ve beklenmeyen kapanışlarda bile log kaybını en aza indirmek.

## Özellikler

- **Byte bazlı rotation**: `maxSize` değeri karaktere göre değil, doğrudan byte cinsinden uygulanır.
- **Yedek dosyalar**: `app.log` + `Backup_0_app.log`, `Backup_1_app.log`, ... yapısıyla dönen log dosyaları.
- **Crash-safe**: `exit`, `SIGINT`, `SIGTERM` gibi sinyallerde logları diske flush eder.
- **Formatter desteği**: her log satırını istediğin formatta (string veya Buffer) üretebilirsin.
- **Console entegrasyonu**: doğrudan `console` nesnesini sarabilir veya bağımsız logger nesneleri oluşturabilirsin.
- **`continueFromLast` ayarı**: uygulama yeniden başladığında eski loglar silinsin mi, yoksa devam mı edilsin, konfigüre edebilirsin.

## Kurulum

```bash
npm install elenora
```

## Hızlı Başlangıç

```js
const elenora = require('elenora');

// console'u sar ve logs/app.log'a yaz
elenora.connect(console, {
  filename: 'logs/app.log',
  maxSize: 5 * 1024 * 1024, // 5 MB
  backupCount: 3,
  continueFromLast: true,   // restart'ta history kalsın
  interval: 500             // flush süresi (ms)
});

console.log('Server booted');
console.info('Listening on :3000');
console.warn('Something feels off');
console.error('Boom.');
```

Diskte en fazla `1 + backupCount` parça tutulur:

- `logs/app.log` – en yeni parça
- `logs/Backup_0_app.log` – ondan biraz eski
- `logs/Backup_1_app.log` – daha eski

Her dosya en fazla `maxSize` byte. En eski byte’lar önce gider.

## API

### `connect(output, options)`

Var olan bir logger benzeri objeyi (genelde `console`) sarar.

```ts
connect(output: any, options?: {
  filename?: string;
  maxSize?: number;          // byte, varsayılan 5 * 1024 * 1024
  backupCount?: number;      // varsayılan 0
  interval?: number;         // ms, varsayılan 1000
  timeZone?: string;         // toLocaleString'e geçer
  continueFromLast?: boolean;// varsayılan false
  Formatter?: (entry: LogEntry, dateString: string) => string | Buffer;
})
```

`LogEntry` şekli:

```ts
interface LogEntry {
  level: 'LOG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
}
```

- `output`: `log`, `info`, `warn`, `error` metodları olan herhangi bir obje. `connect` bunları wrap’ler ama orijinalini de çağırır.
- `filename`: ana log dosyası path’i. Backup dosyalar aynı klasörde durur.
- `maxSize`: her dosya için **byte** cinsinden üst sınır.
- `backupCount`: kaç adet backup dosyası tutulacak.
- `interval`: loglar RAM’den diske ne kadar sıklıkla yazılacak (ms).
- `continueFromLast`:
  - `false` (varsayılan): proses her start olduğunda mevcut log dosyası silinir, tertemiz başlar.
  - `true`: mevcut dosya kalır, üzerine yazıp rotate etmeye devam eder.
- `Formatter`: tek bir log entry’yi formatlar. Vermezsen default plain text format kullanılır.

#### Varsayılan formatter

```text
[LEVEL] 16.11.2025 12:47:39 - message\n
```

### `newLog(options)`

`console`’ı ellemeyip ayrı bir logger objesi oluşturmak için.

```js
const elenora = require('elenora');

const logger = elenora.newLog({
  filename: 'logs/api.log',
  maxSize: 2 * 1024 * 1024,
  backupCount: 2
});

logger.log('api online');
logger.info('GET /health ok');
logger.warn('rate limit yaklaştı');
logger.error('db timeout');
```

Dönen obje:

- `log(...args: any[])`
- `info(...args: any[])`
- `warn(...args: any[])`
- `error(...args: any[])`

## Custom Formatter

Format tamamen senin. Mesela JSON satır logları:

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

console.log('merhaba json');
```

Tam kontrol istersen Buffer da dönebilirsin:

```js
function bufferFormatter(entry, date) {
  const line = `[${entry.level}] ${date} :: ${entry.message}\n`;
  return Buffer.from(line, 'utf8');
}
```

## Rotation Detayları

- Loglar önce RAM’de birikir, `interval` ms’de bir veya proses sinyallerinde (exit, ctrl+c, vs) diske yazılır.
- Her flush’ta:
  - Mevcut dosya içeriği + yeni loglar tek bir büyük Buffer’a birleştirilir.
  - Bu Buffer `maxSize` byte’lık parçalara bölünür.
  - Sadece en yeni `1 + backupCount` parça tutulur.
  - Her parça ilgili dosyaya **baştan** yazılır:
    - en yeni → `app.log`
    - daha eskiler → `Backup_0_app.log`, `Backup_1_app.log`, ...

Böylece tuhaf “yarım overwrite” durumları olmaz, her flush dosyaları temiz şekilde yeniden yazar.

## Teknik Notlar

- Dosya işlemleri bilerek sync tutulmuştur; amaç daha öngörülebilir ve basit bir davranış sağlamaktır.
- Yüksek trafik altında çalışan servislerde `maxSize` değerini makul (MB seviyesinde) tutmak önerilir.
- Ek bağımlılık yoktur; yalnızca Node’un yerleşik `fs` ve `path` modüllerini kullanır.

## Lisans

MIT benzeri, açık kaynak lisans yapısı. Detaylar için repository içeriğine bakabilirsiniz.
