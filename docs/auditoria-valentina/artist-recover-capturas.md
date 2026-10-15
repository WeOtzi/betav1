# Recuperar contraseña · artista · galería de los cuatro pasos

Capturas de `/recover?from=artist` en `preview-local-safe`, con Chrome aislado a **1440 × 900** y **390 × 900**. Los pasos 1–3 se tomaron de la UI de `1377e80`; el paso 4 fue reemplazado con la UI del nodo 243:2778 en esta entrega. La altura de página incluye la barra amarilla PREVIEW. Para mostrar cada vista sin enviar correos, verificar OTP ni actualizar una contraseña, se alternó **solo el DOM de esa sesión de captura**. El único correo mostrado es `artista@example.invalid`; los campos de contraseña están vacíos. Las imágenes muestran composición, **no** una recuperación completada ni persistencia real.

El paso 4 corresponde al [SVG del nodo 243:2778](https://www.figma.com/design/WHCgICsA3ipbAE2srVls9A/Pantallas--We-Otzi--copia-?node-id=243-2778). El check está incluido en el HTML y se ve aun sin CDN. El texto del botón reproduce Figma; la acción existente conserva la sesión y lleva al destino según rol, no obliga a volver a autenticarse.

## Paso 1 · Email

**Desktop**

![Paso 1, desktop de 1440 px](capturas/artist-recover/paso-1-desktop.png)

**Celular**

![Paso 1, celular de 390 px](capturas/artist-recover/paso-1-celular.png)

## Paso 2 · Código

**Desktop**

![Paso 2, desktop de 1440 px](capturas/artist-recover/paso-2-desktop.png)

**Celular**

![Paso 2, celular de 390 px](capturas/artist-recover/paso-2-celular.png)

## Paso 3 · Nueva contraseña

**Desktop**

![Paso 3, desktop de 1440 px](capturas/artist-recover/paso-3-desktop.png)

**Celular**

![Paso 3, celular de 390 px](capturas/artist-recover/paso-3-celular.png)

## Paso 4 · ¡Contraseña actualizada!

**Desktop**

![Paso 4 rediseñado, desktop de 1440 px](capturas/artist-recover/paso-4-desktop.png)

**Celular**

![Paso 4 rediseñado, celular de 390 px](capturas/artist-recover/paso-4-celular.png)
