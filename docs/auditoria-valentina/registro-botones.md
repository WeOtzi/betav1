# Registro de beta · botones

Referencia: [Figma 22:1106](https://www.figma.com/design/UmVbDewiAHkfLedTR5uyFj/Pantallas--We-Otzi?node-id=22-1106).
Fecha: 2026-10-06. Cambio local, sin publicación en beta.

Se adaptaron las proporciones 136:102:118 del DS al ancho existente del formulario, el borde de 1.232 px, la altura social de 25.863 px y la altura principal de 54.189 px. Se usan los cinco SVG originales de este nodo y fuentes locales Inter/JetBrains Mono. Se conserva el resto de la composición de la página y los handlers de registro y proveedores.

El margen negativo del tag fue sustituido por un gap de 4 px. Los botones sociales no se desplazan hacia el tag durante hover. En móvil se apilan y tienen 44 px de altura.

Prueba Chromium con `npm run dev:safe`: 1440, 768 y 390 px, separación medida de 4 px, sin scroll horizontal ni texto desbordado, iconos locales cargados. Email enfoca `beta-fullname`; Facebook conserva el aviso de próxima disponibilidad. No se envió un registro ni se probó OAuth real. `git diff --check` y `npm run check:release` aprobados.

Capturas: [desktop](registro-botones/desktop.png), [móvil](registro-botones/mobile.png). El widget flotante de soporte es compartido y anterior a este cambio.

Rollback: revertir solamente los cambios de HTML/CSS y assets de registro de esta entrega; no incluye migraciones o cambios de datos.
