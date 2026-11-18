# Auditoría de seguridad: `sharp` (T8)

> **Veredicto: APTO con condiciones.** Puedes agregar `sharp@0.35.5` fijado de forma exacta. No ejecuta nada al instalarse ni usa la red, y la 0.35.5 corrige todos los avisos publicados. Antes de fusionar, confirma en el servidor que glibc es 2.28 o superior y que la CPU tiene SSE4.2. Además, en el código aplica `limitInputPixels`, `failOn`, `sharp.block(...)`, `concurrency(1)` y `cache(false)`. Usa `jimp` solo si el servidor no cumple esos requisitos.
>
> **Resultado (2026-11-18):** el dueño aprobó agregarla. El servidor de beta tiene glibc 2.34, CPU x86_64 con SSE4.2 y Node 22.23.

Fecha: 2026-11-18. No instalé nada. Revisé la copia suelta de `C:/dev/weotzi-unified/node_modules`, que no está declarada en `package.json`, y la comparé con el registro de npm y con los avisos de GitHub.

## 1. Qué hay instalado

| Paquete | Versión | Licencia | Tamaño |
|---|---|---|---|
| `sharp` | 0.35.5 (`latest` en npm) | Apache-2.0 | ~1 MB |
| `@img/sharp-win32-x64` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | 19 MB (`libvips-42.dll` + `.node`) |
| `@img/sharp-wasm32` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | 9 MB, sobra (es el respaldo WASM) |
| `@img/colour` | 1.1.0 | MIT | 90 KB |
| `detect-libc` / `semver` | 2.1.2 / 7.8.5 | Apache-2.0 / ISC | pequeños |

El hash de integridad de `sharp` en `node_modules/.package-lock.json` (`sha512-Ywn4OnzG…C7g==`) coincide con el del registro. Los binarios incluyen libvips 8.18.7, librsvg 2.63.2, libheif 1.23.5, libwebp 1.6.0, libpng 1.6.58 y mozjpeg.

## 2. Ejecución en la instalación y uso de red

- **Sin scripts de instalación.** `scripts` no tiene `preinstall`, `install` ni `postinstall`, y lo mismo pasa en `@img/sharp-linux-x64` y `@img/sharp-libvips-linux-x64`. El `binding.gyp` está en `src/` y no en la raíz, así que npm tampoco lanza `node-gyp rebuild` por su cuenta. `install/build.js` solo se ejecuta a mano con `npm run build` para compilar desde el código fuente.
- **Compatible con nuestro despliegue.** Beta instala con `npm ci --omit=dev --ignore-scripts` (RELEASE-RUNBOOK) y `sharp` funciona sin scripts.
- **Sin red en tiempo de ejecución.** El código JS no usa `http`, `net` ni `fetch`. Solo usa `child_process` para `pkg-config` y `node-gyp`, que sirven para compilar desde el código fuente, y para `sysctl`, que solo se ejecuta en macOS. En la carga, `detect-libc` puede consultar `getconf` para saber la libc. Lo demás es un `require` del `.node` que corresponde a la plataforma.
- **Origen de los binarios.** `@img/sharp-linux-x64@0.35.5` y `@img/sharp-libvips-linux-x64@1.3.4` publican una atestación de procedencia SLSA v1 en npm, construida en CI desde `github.com/lovell/sharp` y `lovell/sharp-libvips`. Hay un único mantenedor, Lovell Fuller, muy activo. Ese mantenedor único es un riesgo de continuidad y no de seguridad.

## 3. Vulnerabilidades conocidas

| Aviso | Componente | Afecta | Corregido |
|---|---|---|---|
| GHSA-wq5f-xc86-pv6w (alto, 8.9) | librsvg: uso tras liberar, posible RCE en glibc | < 0.35.5 | **0.35.5** |
| GHSA-rgj7-g3m4-5g8c (alto, 8.9) | libheif: desbordamiento de heap | < 0.35.4 | 0.35.4 |
| GHSA-f88m-g3jw-g9cj (alto) | libvips: cargadores GIF, TIFF y `.v` | < 0.35.0 | 0.35.0 |
| GHSA-54xq-cgqr-rpm3 | libwebp CVE-2023-4863 | antiguas | 0.32.6 |
| GHSA-gp95-ppv5-3jc5 (moderado) | entorno de compilación | antiguas | — |

La 0.35.5 no tiene ningún aviso abierto. Casi todos los avisos vienen de los decodificadores en C que procesan imágenes no confiables, así que la configuración de la sección 5 importa tanto como la versión. Suscríbete a los avisos del repositorio y actualiza cuando salga uno nuevo.

## 4. Licencias y encaje en producción

- **LGPL-3.0 de libvips.** Las obligaciones de la LGPL se activan al *distribuir* el binario. Un SaaS que lo ejecuta en su propio servidor no lo distribuye, y la LGPL no tiene la cláusula de red de la AGPL. No hay obligaciones prácticas. Si algún día entregas el binario a terceros (una imagen Docker o una app de escritorio), tendrías que incluir los avisos y permitir sustituir la biblioteca. El enlace dinámico ya cumple esto último.
- **Paquetes para el servidor Linux x64 con glibc y Node 22:** `@img/sharp-linux-x64@0.35.5` y `@img/sharp-libvips-linux-x64@1.3.4`. Necesitas glibc 2.28 o superior y una CPU con SSE4.2 (microarquitectura x86-64-v2). Si no la tiene, `sharp` falla al cargar con «Unsupported CPU». Los paquetes `linuxmusl-*` solo sirven para Alpine y aquí no aplican. Compruébalo por SSH con `ldd --version` y `grep -c sse4_2 /proc/cpuinfo`.
- **Disco:** unos 20 MB por release (sharp 1 MB, linux-x64 0.4 MB, libvips 18.7 MB). Multiplícalo por las releases que conserva el servidor, porque la cuota es justa.
- **Memoria y CPU** para llevar imágenes de hasta 10 MB a 64×64 en gris: libvips procesa en franjas y el JPEG se decodifica reducido (*shrink-on-load*). Espera picos de decenas de MB y entre 10 y 50 ms por imagen. Los PNG grandes cuestan más porque se decodifican completos. Todo esto ocurre fuera del hilo principal de Node.

## 5. Uso seguro (para `lib/image-decode.js`)

```js
sharp.cache(false);          // no retener memoria entre trabajos
sharp.concurrency(1);        // hosting compartido: un hilo de libvips
sharp.block({ operation: [   // solo aceptamos JPEG/PNG/WebP
  'VipsForeignLoadSvg', 'VipsForeignLoadHeif', 'VipsForeignLoadTiff',
  'VipsForeignLoadVips', 'VipsForeignLoadPdf', 'VipsForeignLoadMagick'
]});
sharp(buffer, { limitInputPixels: 40_000_000, failOn: 'error',
                sequentialRead: true, animated: false, pages: 1 })
  .greyscale().resize(64, 64, { fit: 'fill' }).raw().toBuffer();
```

Antes de llamar a `sharp`, valida los *magic bytes* y el tamaño del archivo (10 MB o menos). Envuelve la llamada en `try/catch` y respeta `isAvailable()`.

**HEIC:** no lo soporta. El binario precompilado trae libheif solo con el códec AV1, así que lee AVIF pero no HEIC/HEVC, por patentes. Las fotos HEIC de iPhone se rechazan y la persona debe subirlas en JPEG.

## 6. Alternativa: `jimp` 1.6.1

Usa licencia MIT, es JavaScript puro, no tiene scripts de instalación y no requiere CPU ni glibc concretas. Ocupa unos 3,3 MB más 27 paquetes `@jimp/*`, pero **no publica atestación de procedencia**. No tiene avisos directos. Los que tuvo en el pasado venían de `jpeg-js`. Sus contras: decodifica la imagen completa en RGBA dentro del heap de JS (una foto de 12 MP ocupa unos 48 MB o más), es entre 10 y 50 veces más lento y bloquea el *event loop*, así que tendrías que usar `worker_threads`. Además, WebP necesita un paquete WASM aparte. Es un buen plan B si el servidor no cumple los requisitos de la sección 4.

## 7. Cambio que apruebas y verificación

En la rama de la feature, desde un `node_modules` limpio:

```bash
npm install --save-exact sharp@0.35.5
```

- `package.json`: `"sharp": "0.35.5"` en `dependencies`, sin `^`.
- `package-lock.json`: entradas nuevas para `sharp`, `@img/colour`, `detect-libc` y las 25 `@img/sharp-*` opcionales, cada una con `os`, `cpu` y `libc` y su `integrity` sha512. `semver` sube de 7.7.3 a 7.8.5 o se anida.
- Revisa que el lockfile tenga `node_modules/@img/sharp-linux-x64` y `node_modules/@img/sharp-libvips-linux-x64`. El fallo de npm #4828 puede dejarlas fuera si generas el lockfile en Windows con `node_modules` ya poblado. Si faltan, regenera el lockfile o añádelas con `npm install --os=linux --cpu=x64 --libc=glibc`.
- **Integridad:** `npm ci` compara cada tarball con el `integrity` del lockfile y aborta si no coincide. Para comprobar las firmas del registro y la procedencia, ejecuta `npm audit signatures`.
- **Prueba en el servidor:** `node -e "console.log(require('sharp').versions)"`. Debe mostrar `vips: '8.18.7'`.
- **Limpieza:** borra la copia suelta de `C:/dev/weotzi-unified/node_modules` (`sharp`, `@img/*`) o regénerala con `npm ci`, para que no oculte la falta de declaración.
