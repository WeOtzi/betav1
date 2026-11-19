# Despliegue en Easypanel

Esta guía quedó reemplazada. Beta en el VPS con Easypanel se documenta en
[`deployments/vps/README.md`](../deployments/vps/README.md) (imagen construida por
GitHub Actions tras el CI, deployer en el VPS, corte de DNS y rollback), y el plan
de la migración en [`docs/plans/2026-11-18-migracion-beta-vps.md`](plans/2026-11-18-migracion-beta-vps.md).

La versión anterior de esta guía (Dockerfile en la raíz, build desde Git en
Easypanel, dominio `weotzi.chat`) ya no aplica: aquel Dockerfile no incluía `lib/`,
`services/` ni `templates/`.
