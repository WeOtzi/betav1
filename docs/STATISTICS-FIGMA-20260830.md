# Estadísticas Figma 2026-08-30

## Alcance

- Ruta autenticada: `/my-quotations/statistics/`.
- Fuente: Figma `UmVbDewiAHkfLedTR5uyFj`, nodo `122:12196`, frame `1440 × 2950`.
- Superficies: seis KPIs, embudo, evolución, rendimiento, actividad reciente, oportunidades y visitantes.
- Navegación: conserva `<weotzi-product-nav>` y `<weotzi-product-footer>` compartidos; el frame de comparación termina antes del footer.

## Uso

- **Semana**, **Mes** y **Año** recalculan la evolución sin cambiar de página.
- **Visitas al perfil**, **Solicitudes recibidas**, **Reservas confirmadas** e **Ingresos (miles)** cambian la serie y su total.
- **Todos**, **Clientes potenciales** y **Estudios** filtran el directorio y actualizan el contador `N de 12 visitantes`.
- **Exportar informe** descarga un CSV con KPIs, estilos, ciudades y trabajos más vistos.

## Contrato de datos

- `quotations_db`: solicitudes, cotizaciones, reservas, trabajos, ingresos, estilos, ciudades y recurrencia.
- `artist_profile_visits_daily`: totales y evolución de `profile_view` y `portfolio_view`; evita truncar métricas cuando el stream crudo está paginado.
- `artist_profile_visits`: visitantes identificables, intereses, actividad y horarios. El frontend sólo muestra las instantáneas permitidas por el contrato RLS existente.
- `artist_artwork_view_counts`: ranking de trabajos.
- `studio_artist_memberships` y `studio_spot_applications`: invitaciones y postulaciones recientes cuando existen.

## Fixture local y rollback

`supabase/seeds/20260829_isainaz_statistics_demo.sql` apunta únicamente a `isainazartattoo.wo`. Usa el marcador `[PRUEBA][STATS-ISAINAZ-20260829]`, reemplaza sólo sus propias filas e incluye los 12 visitantes de la referencia. Los eventos anónimos completan los agregados del frame sin inventar usuarios de Auth.

El seed no fue aplicado a Supabase remoto durante este cambio. Para revertirlo después de una aplicación autorizada:

```sql
delete from public.artist_profile_visits
where referrer = '[PRUEBA][STATS-ISAINAZ-20260829]';
```

## Validación realizada

```text
node --check public/shared/js/statistics.js
node --test tests/statistics-figma.test.js
```

- Resultado enfocado: `7/7` pruebas.
- Playwright desktop: `1440 × 2950`, cifras `4.820 / 1.340 / 86 / 74 / 21 / $3,15M`, 12 visitantes y cero errores de consola.
- Interacciones: 8 clientes potenciales, 4 estudios, cambio de métrica/período y descarga `informe-weotzi-2026-07-31.csv`.
- Responsive: capturas a `768 × 1024` y `390 × 844`; la tabla pasa a tarjetas etiquetadas sin ocultar valores o solicitudes.
- Evidencia local: `output/playwright/statistics-figma-1440.png`, `statistics-figma-768.png` y `statistics-figma-390.png`.

No se realizó deploy ni commit.
