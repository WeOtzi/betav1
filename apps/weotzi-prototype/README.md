# Weötzi — prototipo local basado en Figma

Este paquete demuestra, de punta a punta, un recorrido móvil de Weötzi: alta y verificación, onboarding de artista, exploración de inspiración, perfil público, reservas Flash o personalizadas y mensajería persistida. Es una aplicación local funcional, no una colección de pantallas estáticas.

El paquete es autónomo. Su cliente, API, base de datos, dependencias y artefactos viven dentro de `apps/weotzi-prototype`; no importa ni modifica el runtime de la aplicación raíz.

## Requisitos

- Node.js 22 o superior.
- npm, incluido con Node.js.

## Instalación

Desde `apps/weotzi-prototype`:

```powershell
npm ci
```

Los valores predeterminados funcionan sin credenciales ni servicios externos.

## Desarrollo

```powershell
npm run dev
```

Este comando inicia ambos procesos:

- Interfaz: `http://127.0.0.1:5174`.
- API: `http://127.0.0.1:4546`; el estado se puede consultar en `http://127.0.0.1:4546/api/health`.

Vite mantiene el puerto `5174` como estricto y redirige las solicitudes `/api` al servidor local en `4546`. Si un puerto ya está ocupado, hay que liberar ese proceso antes de volver a iniciar el prototipo.

Para cambiar el puerto de la API, copia `.env.example` como `.env` y ajusta `PORT`; el proxy de desarrollo reutiliza ese valor. `VITE_API_ORIGIN` permite apuntar explícitamente a otro origen cuando la API corre por separado.

El código de verificación de la demo es **`241041`**.

## Ejecución equivalente a producción

Primero genera el cliente y después inicia el servidor único:

```powershell
npm run build
npm run start
```

Express sirve tanto `dist/` como `/api` desde `http://127.0.0.1:4546`. Esta modalidad facilita la revisión local, pero no convierte el prototipo en un servicio endurecido para producción.

## Datos locales y reinicio

La base SQLite predeterminada está en `data/weotzi-prototype.sqlite`. SQLite también puede crear los archivos laterales `-wal` y `-shm` mientras el servidor está activo. La ubicación se puede cambiar definiendo `WEOTZI_DB_PATH` en la terminal antes de ejecutar `npm run dev` o `npm run start`.

Se conservan entre reinicios:

- altas y verificación de la waitlist;
- perfil y avance del onboarding;
- favoritos;
- solicitudes Flash y personalizadas;
- conversaciones y mensajes.

Para restaurar el estado demo determinista con el servidor en ejecución:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri 'http://127.0.0.1:4546/api/reset' `
  -Headers @{ 'X-Weotzi-Reset' = 'true' }
```

El reinicio elimina las mutaciones locales del prototipo y vuelve a sembrar perfil, portfolio y conversación demo. La API rechaza el pedido con `403` si falta el encabezado de confirmación.

## Rutas y recorridos

| Ruta | Uso |
|---|---|
| `/` | Landing, waitlist, verificación, tres slides de onboarding y configuración del perfil en cinco pasos. |
| `/app/inspiration` | Feed de inspiración, favoritos, cabecera compacta al hacer scroll y acceso a mensajes. |
| `/app/business` | Agenda, solicitudes persistidas y vista previa del inbox del artista. |
| `/profile/el-charlatan` | Perfil público con Trabajos, Tienda, Sobre mí y Reseñas. |
| `/book/custom` | Solicitud de diseño personalizado, revisión y confirmación. |
| `/book/flash` | Reserva de un Flash, revisión y confirmación. |
| `/messages` | Lista de conversaciones. |
| `/messages/:id` | Chat persistido de una conversación. |

Recorridos recomendados para la demo:

1. `/` → registrar email → usar `241041` → completar onboarding → llegar a Inspiración.
2. Inspiración → abrir un trabajo → perfil público → solicitar diseño personalizado → enviar → abrir conversación.
3. Perfil público → Tienda → reservar Flash → enviar → volver a Inspiración.
4. Negocio → comprobar que la solicitud aparece en Agenda/Inbox → abrir el chat → enviar un mensaje → refrescar para comprobar persistencia.

Las rutas que dependen de datos muestran una opción de reintento si la API no está iniciada. Cualquier ruta desconocida vuelve a `/`.

## Pruebas y validación

```powershell
npm run typecheck
npm test
npm run build
```

El atajo completo es:

```powershell
npm run check
```

`npm run check` ejecuta TypeScript sin emisión, la suite Vitest y la compilación Vite. La suite cubre contratos y persistencia SQLite, alta/verificación, onboarding, primitivas accesibles, navegación y foco, configuración del proxy, favoritos, reservas —incluida la elección explícita de si es el primer tatuaje— y mensajería. El gate final del 13 de agosto de 2026 quedó verde: typecheck sin errores, `42` pruebas aprobadas en `7` archivos y build Vite completado.

## Documentación de entrega

- [Registro de fidelidad Figma](docs/FIGMA-FIDELITY.md)
- [Reporte de implementación](docs/IMPLEMENTATION-REPORT.md)
- [Procedencia de los assets Figma](public/assets/figma/SOURCES.md)
