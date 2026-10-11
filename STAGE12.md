# Этап 12 — подэтапы и журнал

Статус: [ ] не начат · [~] в работе · [x] сделано и проверено · [P] запушено

## Подэтапы
- [x] 12.1 Манифест + иконки (client/public/icons, manifest в vite.config)
- [x] 12.2 Service worker: precache оболочки (vite-plugin-pwa, injectManifest), push/клик из sw.ts
- [x] 12.3 Регистрация SW + баннер «нет сети»
- [ ] 12.4 Экран приглашения /invite/<токен> (вход по ссылке)
- [ ] 12.5 Ссылка-приглашение в админке (полная ссылка + «копировать»)
- [ ] 12.6 Деплой: nginx.conf.example, lms.service, deploy.sh
- [ ] 12.7 Бэкап: backup.sh (pg_dump + uploads), проверка восстановления
- [ ] 12.8 Сборка и проверка: typecheck, build, запуск, ручной прогон

## Журнал (что взял в работу / что сделал)
- 2026-10-11: 12.3 сделано — main.tsx регистрирует /sw.js только в PROD, перезагружает страницу при активации новой версии (кроме самой первой установки), shared/OfflineBanner.tsx показывает баннер по online/offline событиям, подключён в App.tsx. Сборка прошла.
- 2026-10-11: 12.2 сделано — client/src/sw.ts (precache через workbox injectManifest, NavigationRoute мимо /api, push + notificationclick перенесены из старого public/sw.js), vite-plugin-pwa@2.0.0 в vite.config.ts, tsconfig.sw.json (sw.ts исключён из основного typecheck). Сборка client прошла, sw.js сгенерирован с precache 8 записей.
- 2026-10-11: 12.1 сделано — иконки 192/512/512-maskable/apple-touch (PNG, PIL), manifest.webmanifest, ссылки в index.html (manifest, theme-color, apple-touch-icon). Сборка client прошла, манифест в dist/index.html подключён.
- 2026-10-11: проект восстановлен из GitHub (состояние этапа 11, 14d4073); план составлен.
