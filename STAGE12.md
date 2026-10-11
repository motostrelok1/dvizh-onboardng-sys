# Этап 12 — подэтапы и журнал

Статус: [ ] не начат · [~] в работе · [x] сделано и проверено · [P] запушено

## Подэтапы
- [x] 12.1 Манифест + иконки (client/public/icons, manifest в vite.config)
- [x] 12.2 Service worker: precache оболочки (vite-plugin-pwa, injectManifest), push/клик из sw.ts
- [x] 12.3 Регистрация SW + баннер «нет сети»
- [x] 12.4 Экран приглашения /invite/<токен> (вход по ссылке)
- [x] 12.5 Ссылка-приглашение в админке (полная ссылка + «копировать»)
- [x] 12.6 Деплой: nginx.conf.example, lms.service, deploy.sh
- [x] 12.7 Бэкап: backup.sh (pg_dump + uploads), проверка восстановления
- [x] 12.8 Сборка и проверка: typecheck, build, запуск, ручной прогон

## Журнал (что взял в работу / что сделал)
- 2026-10-11: 12.8 сделано — server build (tsc) и client build (tsc+vite+sw) чистые. Сквозной прогон: сервер поднят, /health и /health/db ok; выпуск приглашения (npm run invite), GET статуса ссылки, accept с установкой пароля, сессия по cookie, /auth/me, повторный вход по email/паролю — всё отработало. Статика client/dist: index.html с нужным title, manifest.webmanifest валиден, sw.js отдаётся, иконки 192/512 доступны, SPA fallback на /invite/<токен> подтверждён (через vite dev в 12.4). Этап 12 завершён полностью.
- 2026-10-11: 12.7 сделано — deploy/backup.sh (pg_dump --format=custom + tar uploads, ротация по KEEP_DAYS, инструкция восстановления в комментарии). Проверено вживую: подняты Postgres+миграции, посеян админ, добавлен тестовый файл в uploads, снят бэкап, восстановлен в чистую БД lms_restore_check через pg_restore (данные дошли) и tar -xzf (файл вложения дошёл и читается). Тестовая БД и файлы удалены после проверки.
- 2026-10-11: 12.6 сделано — deploy/nginx.conf.example (статика client/dist, прокси /api на 127.0.0.1:3000, no-cache на index.html/sw.js/manifest, client_max_body_size 55m, deny скрытых файлов, заготовка map для маскирования токена в access_log + пометка про нерешённый SEC-07 в error_log), deploy/lms.service (systemd, ProtectSystem=strict), deploy/deploy.sh (git pull, npm ci, миграции, сборка server/client, rsync в WEB_ROOT, restart, health-check). Синтаксис deploy.sh проверен (bash -n).
- 2026-10-11: 12.5 сделано — EmployeesTab.tsx: ссылка из API (относительный путь) превращается в полный URL (new URL(link, location.origin)) перед показом, кнопка «Копировать» через navigator.clipboard с фолбэком (текст и так виден) и индикацией «Скопировано». Сборка прошла.
- 2026-10-11: 12.4 сделано — shared/InviteScreen.tsx (проверка ссылки GET /auth/invitations/:token, форма пароля, POST .../accept, типовые тексты причин невалидности), маршрут /invite/<токен> в App.tsx (чтение location.pathname, без роутера; после успеха чистит URL и состояние). Сборка прошла, dev-сервер отдаёт SPA-оболочку на /invite/abc123 (200).
- 2026-10-11: 12.3 сделано — main.tsx регистрирует /sw.js только в PROD, перезагружает страницу при активации новой версии (кроме самой первой установки), shared/OfflineBanner.tsx показывает баннер по online/offline событиям, подключён в App.tsx. Сборка прошла.
- 2026-10-11: 12.2 сделано — client/src/sw.ts (precache через workbox injectManifest, NavigationRoute мимо /api, push + notificationclick перенесены из старого public/sw.js), vite-plugin-pwa@2.0.0 в vite.config.ts, tsconfig.sw.json (sw.ts исключён из основного typecheck). Сборка client прошла, sw.js сгенерирован с precache 8 записей.
- 2026-10-11: 12.1 сделано — иконки 192/512/512-maskable/apple-touch (PNG, PIL), manifest.webmanifest, ссылки в index.html (manifest, theme-color, apple-touch-icon). Сборка client прошла, манифест в dist/index.html подключён.
- 2026-10-11: проект восстановлен из GitHub (состояние этапа 11, 14d4073); план составлен.
