# PROGRESS.md

## Актуальное состояние production — 15 октября 2026

> Этот раздел имеет приоритет над историческими этапными записями ниже. Подробная сверка — [docs/PROJECT-AUDIT-2026-10-15.md](docs/PROJECT-AUDIT-2026-10-15.md), план — [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md).

- Реальный сайт: https://lms.dvizh-school.ru, VDS Ubuntu 24.04, Node 24 (`/opt/node24/bin`), PostgreSQL 16, `lms.service` на `127.0.0.1:3001`, frontend `/var/www/lms/client-dist`.
- PR #25–42 включают оформление админки, редактор курсов, предпросмотр и демотест, медиа, сворачивание, сортировку, единый стиль контролов, GitHub Actions deploy и SSH verification. Последний подтверждённый по GitHub Actions автоматический production deploy: `29b627c` из PR #42, CI [38768757644](https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38768757644). Это подтверждение успешной публикации по логу, **не** полного визуального аудита каждой страницы.
- PR #38 настроил защищённый ручной скрипт; PR #39 проверил SSH; PR #41 включил автоматическое обновление после зелёных build + integration на `main`. Проверенный деплой PR #41: [38766575126](https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38766575126). Ручной workflow сохранён.
- Во время обновления root-owned скрипт делает backup БД/вложений/предыдущих frontend и backend build, сверяет health, при сбое пытается откатить бинарники. Миграции, изменения lockfile/зависимостей и части инфраструктуры автоматически блокируются и требуют отдельного плана.
- Оператор успешно проверил в браузере: дашборд, редактор курса «администратор», сворачивание/сортировку, предпросмотр и демотест, видео и вложения. Единые стили из PR #42 опубликованы, но повторная визуальная проверка после публикации пока не подтверждена.
- Проверенный дамп БД и архив uploads были восстановлены/прочитаны в тестовой БД в ходе подготовки к деплою; **периодический backup, срок хранения, мониторинг, push на устройстве, E2E/роли/метрики и аудит зависимостей требуют отдельной проверки**.


## Фактический VDS: первый запуск 2026-10-15 (подтверждено оператором)

- [x] Ubuntu 24.04, отдельный Node.js 24.22.0 в `/opt/node24` (системный Node.js 22 не менялся), исходники `/opt/lms`.
- [x] PostgreSQL 16.15: отдельная база/роль `lms`, 17 миграций, 28 таблиц, оба integrity preflight прошли.
- [x] systemd `lms.service` от пользователя `lms`, порт 3001 на `127.0.0.1`; локальные `/health` и `/health/db` вернули OK.
- [x] Nginx: `/var/www/lms/client-dist`, домен `https://lms.dvizh-school.ru`, публичные GET / и /api/health вернули HTTP 200; администратор создан и вход в админку подтверждён скриншотом.
- [x] PR #24 сохраняет loopback-bind в main; PR #23 (DEV-05.2 upload capacity) слит, main `2635dbb`.
- [x] **VDS обновлён до main**: успешный GitHub Actions deploy PR #38–42, последний подтверждённый SHA `29b627c` (2026-10-15); старое состояние `bd801ad` относится к этапу первого запуска.
- [ ] Применить полный защищённый Nginx vhost из шаблона (логирование/маскирование приглашений, безопасные headers, proxy_request_buffering off для DEV-05.2); проверить отдельные сайты не затронуты.
- [ ] Проверить сертификат/редирект HTTP→HTTPS, PWA/push на устройствах, браузерный end-to-end тест, аудит 6 npm advisory (1 moderate/5 high при установке).
- [x] Разовая резервная копия DB + uploads и тест восстановления перед первым full-stack обновлением; безопасный скрипт согласованного автоматического deploy/rollback установлен и проверен GitHub Actions.
- [ ] Проверить **периодичность** backup, ротацию, мониторинг, отдельное восстановление последнего автоматического backup и план disaster recovery.

**Не путать успешный запуск и готовность к production:** безопасность vhost, backup/restore, audit и функциональная приёмка остаются открытыми. Данные паролей/токенов в документацию не заносить.

## Стек
- Backend: Node.js + TypeScript, Fastify
- БД: PostgreSQL
- Frontend: React + Vite (PWA)
- Веб-сервер: Nginx
- Размещение: VDS, поддомен второго уровня к сайту автошколы (например edu.домен.ru)

## Как запустить
Из корня: `npm ci`, затем настроить env и локальную БД по
[README](README.md#запуск-разработка). `npm run migrate --workspace server`,
`npm run dev --workspace server` и в другом терминале
`npm run dev --workspace client`. Первый администратор — README.
Сборка: `npm run build`; SQL-тесты только на отдельной `_test` БД —
[карта/команды тестов](server/tests/README.md). Production/backup/rollback —
[DEPLOY.md](DEPLOY.md).

## Актуальный статус

Код этапов 0–12 и подэтапы H01–H19 реализованы и проверены в репозитории/CI.
DEV-10.1, DEV-05.1 и DEV-05.2 выполнены; проверено 399/399 в [CI PR #23 на 5eac679](https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38382124194)
(2026-10-13), без ошибок/пропусков.
[Чек-лист и CI](HARDENING.md), [незакрытые рекомендации](additions.md#актуальный-backlog).
Старые записи ниже описывают результат своего этапа; последующие H имеют
приоритет при описании текущего поведения. VDS/реальная доставка push,
сеть/backup restore и browser E2E здесь не объявляются проверенными.

## Задачи

- [x] 0. Подготовка: структура репозитория, окружение
      Готово: монорепо server/client, Fastify+TS сервер с /health и /health/db,
      React+Vite клиент с проверкой связи, docker-compose с PostgreSQL

- [x] 1. БД: миграции для ядра
      Готово: node-pg-migrate, таблицы users, courses, modules, lessons,
      lesson_attachments, tests, questions, answers, assignments созданы,
      миграции проверены (npm run migrate). department_id в users и
      source_group_id в assignments — пока без FK, свяжутся при добавлении
      departments/groups (этап 3)

- [x] 2. Вход по ссылке-приглашению
      Готово: миграция invitations+sessions; /auth/invitations/:token (проверка),
      /auth/invitations/:token/accept (пароль+сессия), /auth/login, /auth/logout,
      /auth/me; cookie-сессии (bcrypt для пароля, sha256-хеш для токенов).
      Для тестов без админки: npm run seed:admin, npm run invite — заменятся
      кнопками в админке на этапе 3. Весь сценарий прогнан через curl, работает

- [x] 3. Админка: сотрудники, отделы, группы
      Готово: миграция departments/groups/group_members (+FK к users,
      assignments); requireAdmin-мидлвар; роуты /admin/users, /admin/departments,
      /admin/groups (+ /admin/groups/:id/members), /admin/users/:id/invitations,
      DELETE /admin/invitations/:id. Клиент: экран входа + вкладки
      Сотрудники/Отделы/Группы (создание, отдел и часовой пояс у сотрудника,
      выпуск ссылки-приглашения, чекбоксы состава группы).
      Прогнано через curl и через клиент за прокси Vite — работает

- [x] 4. Админка: курсы, модули, уроки (видео, текст, вложения)
      Готово: роуты /admin/courses (+ /tree), /admin/modules, /admin/lessons,
      /admin/modules|lessons/reorder; загрузка/скачивание/удаление вложений
      (/admin/lessons/:id/attachments, /attachments/:id/download) с проверкой
      типа (pdf/doc/docx/xls/xlsx/png/jpg) и лимитом 50 МБ — типы и лимит
      временные, см. открытый вопрос в SPEC §18. Клиент: вкладка «Курсы»
      со списком, редактором дерева модуль→урок→вложения, кнопками ↑/↓ для
      порядка, полями видео (провайдер+ссылка) и текста урока.
      Прогнано curl'ом (включая блокировку .exe и удаление файла с диска)
      и через клиент за прокси Vite — работает

- [x] 5. Тесты: редактор и настройки
      Готово: /admin/tests (создание на модуль/урок, не более одного — 409 на
      дубликат), настройки (maxAttempts/showCorrectAnswers/passScore),
      /admin/tests/:id/questions, /admin/questions/:id/answers — CRUD.
      Дерево курса (/admin/courses/:id/tree) отдаёт test у модуля и у урока.
      Клиент: TestBlock — настройки, вопросы (чекбокс «неск. верных»),
      варианты с чекбоксом «верный», встроен в модуль и в урок редактора курса.
      Прогнано curl'ом (включая 409 на дубликат) и через клиент за прокси —
      работает

- [x] 6. Назначения и дедлайны
      Готово: миграция source_department_id; /admin/assignments (назначение
      человеку/группе/отделу — на человека одна строка, повторное назначение
      обновляет дедлайн через upsert), /admin/assignments/:id/extend-deadline
      (возвращает доступ, если был overdue), DELETE /admin/assignments/:id.
      Фоновая проверка каждые 60с (closeOverdueAssignments) переводит
      просроченные в status=overdue — это и есть «закрыт доступ к этому курсу»;
      плюс ручной запуск POST /admin/assignments/run-deadline-check.
      Клиент: вкладка «Назначения» — форма (курс/кому/дедлайн/обязательный),
      список со статусами, перенос дедлайна, снятие назначения.
      Упрощение: дедлайн хранится как переданный момент времени, пересчёт
      конца дня под часовой пояс сотрудника не делается — доработать при
      необходимости. Прогнано curl'ом (включая автозакрытие и upsert) и
      через клиент за прокси — работает

- [x] 7a. Кабинет сотрудника: список курсов и экран курса
      Готово: /me/courses (назначенные + открытый каталог без уже назначенных),
      POST /courses/:id/enroll (самозапись), /me/courses/:id (структура
      модуль→урок, метаданные без контента — контент в 7b, без вопросов теста
      — в 7c). Проверка доступа: overdue → 403 deadline_passed, не назначен и
      не open_catalog → 403 not_assigned, open_catalog без записи → 403
      not_enrolled. Клиент: EmployeeApp (список, статусы, каталог с
      «Записаться»), CourseScreen (модули/уроки с бейджами видео/текст/
      вложения/тест, понятные сообщения об ошибках доступа). App.tsx теперь
      выбирает AdminApp/EmployeeApp по роли после логина; форма входа вынесена
      в shared/LoginForm.
      Прогресс по урокам добавлен в этапе 9 и вычисляется из events;
      карточки курса/сотрудника используют его текущую серверную модель.
      Прогнано curl'ом (все ветки доступа, включая реальный overdue) и через
      клиент за прокси — работает

- [x] 7b. Кабинет сотрудника: урок
      Готово: GET /lessons/:id (текст, провайдер/ссылка видео, список
      вложений без file_path); /attachments/:id/download теперь проверяет
      доступ к курсу владельца вложения (раньше — просто вошедший
      пользователь), 403 с тем же набором причин, что и у курса. Общая
      проверка доступа вынесена в src/access.ts (checkCourseAccess,
      getCourseIdForLesson/Attachment), /me/courses/:id переведён на неё же.
      Клиент: LessonScreen (текст, вложения со ссылкой на скачивание),
      VideoPlayer — встраивание для vimeo (iframe) и self_hosted (<video>),
      для прочих провайдеров — заглушка с текстом (полноценный выбор
      провайдера видео всё ещё открытый вопрос, SPEC §18).
      Прогнано curl'ом (доступ/403/401, скачивание) и через клиент за
      прокси — работает

- [x] 7c. Кабинет сотрудника: прохождение теста
      Готово: миграция test_attempts/attempt_answers; POST /tests/:id/attempts
      (лимит попыток — 409 no_attempts_left; повторный заход продолжает
      незавершённую попытку, не плодит новые; вопросы отдаются без
      is_correct), GET /tests/:id/attempts (история), POST
      /attempts/:id/answers (проверка на сервере сравнением множеств id,
      правильность не возвращается клиенту), POST /attempts/:id/finish
      (балл = верных/всего×100, passed по pass_score, разбор — только если
      show_correct_answers; повторный finish — 409). Доступ — через
      checkCourseAccess/getCourseIdForTest из access.ts (та же проверка,
      что у курса и урока). Клиент: TestScreen — вопросы по одному
      (radio/checkbox по test.multiple), результат, разбор с подсветкой
      верных/выбранных, кнопка «пройти ещё раз». Подключено к бейджам теста
      в CourseScreen (у модуля и у урока).
      Прогнано curl'ом (весь цикл: 2 попытки с разным результатом, 409 на
      повторный finish, 409 на превышение лимита) и через клиент за
      прокси — работает

- [x] 8. Журнал событий
      Готово: миграция events (append-only); src/events.ts (logEvent,
      logEventsBatch). Сервер сам пишет: session_start/end (логин, принятие
      приглашения, логаут), test_attempt_start/end, question_answered,
      attachment_download, assignment_created, deadline_extended,
      access_closed (при автозакрытии по дедлайну) — эти типы с клиента не
      принимаются (чтобы нельзя было подделать). POST /events принимает
      только lesson_view_start/end пакетом (до 200 за раз), остальное молча
      отбрасывает. Клиент: src/events.ts — очередь в localStorage, flush по
      таймеру (15с), по событию online и через sendBeacon на pagehide;
      LessonScreen шлёт start/end с длительностью при входе/выходе с урока.
      Прогнано curl'ом (все 8 типов событий проверены в БД напрямую) и через
      клиент за прокси — работает

- [x] 9. Карточка сотрудника и дашборд администратора
      Готово: src/progress.ts — прогресс курса = доля уроков с хотя бы одним
      lesson_view_start в журнале (это и закрывает упрощение из этапа 7a).
      GET /admin/dashboard?departmentId=&groupId= — сводка (всего/активных
      за 7 дней/средний прогресс/просрочено) + таблица сотрудников с
      прогрессом, фильтруется по отделу и группе. GET /admin/users/:id/log —
      карточка: назначения с прогрессом, статистика (сессии, верные/неверные
      ответы, попытки тестов, минуты на уроках), последние 50 событий.
      Клиент: DashboardTab (плитки, фильтры, таблица, переход в карточку),
      EmployeeDetail (назначения с прогресс-барами, статистика, лог событий
      понятным текстом). Дашборд стал стартовой вкладкой админки.
      Прогнано curl'ом (дашборд, оба фильтра, карточка, рост счётчиков после
      новой попытки теста) и через клиент за прокси — работает

- [x] 10a. Ежедневный отчёт
      Готово: миграция daily_reports/analytics_settings/analytics_overrides/
      settings_log; jobs/reports.ts — generateReportForDate (прогресс по
      курсам, верно/неверно за день и всего, сессии, минуты на уроках,
      тесты, текущие флаги) и ensureReportsUpToYesterday (докатывает
      пропущенные дни, backfill капается 14 днями при первом запуске).
      Триггер «по входу админа» — в POST /auth/login. Триггер «по
      расписанию» — фоновый интервал startReportScheduler (сверяет
      report.schedule_time, режим both/schedule). GET /admin/reports/daily
      (дата+фильтры отдел/группа), GET /admin/reports (диапазон), GET
      /admin/reports/export.csv, POST /admin/reports/daily/generate (кнопка
      «Обновить»), GET|PUT /admin/settings/reports. Клиент: ReportsTab —
      выбор даты, фильтры, таблица, «Обновить», ссылка на CSV, настройка
      режима/времени формирования.
      Упрощение: границы дня — UTC, не часовой пояс сотрудника/компании
      (как и дедлайны, этап 6) — доработать вместе.

- [x] 10b. Правила аналитики и пороги
      Готово: analytics/settings.ts — дефолты (SPEC §9.1), общие настройки
      (analytics_settings), переопределения по курсу (analytics_overrides,
      report.* не переопределяются — проверено 400), журнал изменений
      (settings_log, старое/новое значение, кто, когда, курс или общие).
      analytics/rules.ts — все 6 правил: проблемный вопрос (глобально по
      вопросу), пролистал (медиана времени на урок), нужна помощь (N попыток
      подряд без роста), угадывание (сек/вопрос + результат ниже проходного),
      застрял/не начал, риск просрочки — каждое смотрит эффективные
      настройки (дефолт → общие → курс) и свой enabled-флаг.
      GET|PUT /admin/settings/analytics, POST .../reset, GET|PUT
      /admin/courses/:id/analytics-settings, POST .../reset, GET
      /admin/settings/log, GET /admin/analytics/problem-questions. Флаги
      встроены в карточку сотрудника и в дашборд (счётчик на сотрудника +
      общая плитка). Клиент: SettingsTab (пороги по правилам, вкл/выкл,
      сброс, журнал изменений, список проблемных вопросов),
      CourseAnalyticsSettings (переопределение порогов в редакторе курса).
      Прогнано curl'ом (весь цикл: вход триггерит бэкафилл отчётов, флаги
      реально считаются — «нужна помощь» и «угадывание» сработали на
      тестовых данных, запрет переопределения report.* — 400, сброс к
      дефолтам, CSV с исправленным форматом даты) и через клиент за
      прокси — работает

- [x] 11. Уведомления, push, фоновый планировщик
      Готово: миграция notification_rules/notifications/push_subscriptions.
      jobs/notifications.ts — checkAndSendNotifications по правилам
      (before_deadline за N дней / on_deadline / overdue; канал in_app или
      push; для всех курсов или конкретного), при первом запуске сеет
      дефолтные правила (за 7 и 1 день, в день дедлайна, при просрочке — по
      обоим каналам); дедупликация — не больше одного уведомления на
      назначение/тип/канал в день БД (overdue — один раз за всё время).
      Общий lock/атомарность/drain добавлены H16; outbox/retry остаются открыты.
      Часовой интервал startNotificationScheduler + ручной POST
      /admin/notification-rules/run-check. push.ts — web-push с
      VAPID-ключами (npm run vapid:generate, ключи в server/.env; без них
      push тихо отключён, остальное работает), 404/410 от push-сервиса
      автоматически удаляют подписку. Роуты: CRUD /admin/notification-rules,
      GET /me/notifications, POST /me/notifications/:id/read, POST|DELETE
      /me/push-subscription, GET /push/vapid-public-key (публичный).
      Клиент: src/sw.ts (PWA precache и push/клик, обновлён в этапе 12), push.ts (подписка по клику
      пользователя, не автоматически), Notifications.tsx (колокольчик со
      счётчиком непрочитанных, список, «включить/отключить push»),
      NotificationRulesSection в «Настройках» (добавление, вкл/выкл, удаление
      правил).
      Урок для себя: addHook в Fastify действует на ВЕСЬ encapsulation-контекст
      независимо от порядка регистрации маршрутов — публичный
      /push/vapid-public-key пришлось вынести в отдельный плагин.
      Не проверено: реальная доставка push в браузер (нужен браузер с
      разрешением и HTTPS/localhost) — проверены подписка, сохранение,
      удаление, генерация уведомлений и автоудаление протухшей подписки
      логикой и CI, но не получение push на живом устройстве. Иконки
      в client/public/icons добавлены в этапе 12.
      Прогнано curl'ом (дефолтные правила, срабатывание before_deadline и
      overdue в оба канала, дедупликация, отметка прочитанным, подписка/
      отписка) и через клиент за прокси — работает

- [x] 12. PWA-оболочка, полировка, деплой
      Спецификация: SPEC.md §11
      Куда: корень проекта, /client
      Готово когда: приложение устанавливается на телефон, работает на
      сервере в РФ
      Сделано по подэтапам (журнал — STAGE12.md): манифест+иконки, service
      worker с precache оболочки (vite-plugin-pwa injectManifest) и
      push/notificationclick, регистрация SW в PROD + баннер «нет сети»,
      экран /invite#token (SEC-07; legacy /invite/token поддержан), полная ссылка +
      «копировать» в админке, файлы деплоя (nginx.conf.example, lms.service,
      deploy.sh) под VDS/поддомен, backup.sh с живой проверкой восстановления.
      Собрано и прогнано целиком: сервер + собранный клиент, сквозной сценарий
      приглашение → пароль → сессия → вход отработал.
      Замечено отдельно: тестовая инфраструктура клиента (vitest, UI-тесты) и
      hardening по additions.md (SEC-01…11, CSRF) относились к незапушенным
      коммитам конца этапа 11 и были потеряны при сбросе рабочей копии —
      серверный hardening/CI затем восстановлен H01–H18. Browser UI/E2E
      остаются открытыми; эта запись не подтверждает installation на VDS.

## Следующий этап из backlog

- [x] DEV-10.1 — защита приёма событий урока и повторной доставки
      Спецификация: docs/SPEC.md §5.1, §13; backlog additions.md DEV-10.
      Куда: server/src/routes/events.ts, server/src/client-events.ts,
      server/migrations, server/tests; client/src/events.ts, event-queue.ts,
      admin/api.ts, employee/LessonScreen.tsx; документация статусов/deployment.
      Готово когда: сервер проверяет владельца/доступ/лимиты; повторный ID
      не увеличивает статистику; очередь удаляет только ACK IDs, переживает
      offline/потерю ответа, очищается при logout/смене пользователя;
      миграция сохраняет старый журнал, сборка и полный CI успешны.

- [x] DEV-05.1 — очистка файлов при удалении вложений/контента
      Спецификация: docs/SPEC.md §3, §12 (целостность); additions.md DEV-05.
      Куда: server/migrations, src/storage.ts, routes/admin-attachments.ts,
      src/jobs/attachment-cleanup.ts, runner.ts, index.ts, server/tests;
      README/DEPLOY/PROGRESS/additions и карта тестов.
      Готово когда: DELETE и durable queue атомарны, cascade урока/модуля/курса
      очищает только удалённые файлы; rollback не трогает диск; crash/ошибка
      сохраняет retry; live references/unsafe paths защищены; build/CI прошли.

- [x] DEV-05.2 — лимиты параллельных загрузок и свободного места
      Спецификация: docs/SPEC.md §3, §18 (сохраняются текущие типы/50 МиБ);
      additions.md DEV-05. Куда: server/src/upload-capacity.ts, receiver,
      storage, admin-attachments, index, server/.env.example, server/tests;
      client/src/admin/CourseEditor.tsx; deploy/nginx.conf.example/test;
      README/DEPLOY/PROGRESS/additions и карта тестов.
      Готово когда: PG slots общие между процессами; до staging проверяется
      запас, поток прекращается/чистится при low-space/abort; permits не
      теряются при ошибках/stop; UI объясняет отказ; build/полный CI проходят.

## Решения и заметки
### DEV-05.2 — ресурсы загрузки (2026-10-13)
- Реализованы PostgreSQL session advisory slots по canonical UPLOAD_DIR,
  отдельный namespace от jobs. По умолчанию 2 uploads, максимум env 8;
  permit удерживается через receive/format/SQL/cleanup, не только INSERT.
- statfs bigint/bavail: admission требует floor + 50 МиБ на каждый занятый
  slot; default floor 256 МиБ. Проверка перед chunk write и публикацией;
  ENOSPC/EDQUOT → 507 storage_full, unavailable → private 503. Числа/пути
  не выдаются клиенту. Readonly root/parent probe не создаёт каталог для
  некорректного upload; canonical identity стабильна до/после mkdir.
  Logical budget не является физическим резервированием.
- Deadline signal по умолчанию 120 секунд, abort при разрыве клиента/PG,
  освобождение или discard неизвестного session lock, stop/drain до pool.end.
- Admin upload показывает busy/full/timeout/unavailable, блокирует input
  до завершения. Nginx example отключает request buffering при HTTP/1.1,
  чтобы guard начал работать до полного тела; native Nginx test проверяет
  ранний отказ после части объявленного 1 МиБ. Реальный vhost не менялся.
- Локально build/PWA и 145/145 без БД прошли, включая native HTTP partial
  cleanup. Добавлено 27 Node-сценариев (16 без БД, 11 PostgreSQL/API),
  плюс actual Nginx early-body rejection. CI на 5eac679: 399/399 без ошибок/
  пропусков, migrations/re-run/оба preflight, JUnit gate/summary/artifact,
  server/client/PWA и Nginx прошли. DEV-05.2 [x], PR #23.
  Проверенный запуск: https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38382124194
  Новой миграции нет. Все backend должны иметь одну
  БД/root/настройки. Квоты пользователя/курса, alerting, orphan/.part/uncertain
  COMMIT reconciliation остаются DEV-05; VDS не менялся.


### DEV-05.1 — очередь удаления вложений (2026-10-13)
- Реализована миграция 1700000017000: AFTER DELETE trigger сохраняет OLD
  attachment/lesson/path в attachment_file_cleanup в той же транзакции,
  включая FK cascade; нет FK обратно к удаляемому контенту. До COMMIT
  worker не видит job; down отказывается терять незавершённую очередь.
- Direct DELETE: readonly path precheck, transaction/queue/COMMIT, scoped
  best-effort unlink; root/corrupt path не приводят к удалению внешнего файла.
- Worker: новая lane 4 common runner, 50 jobs, immediate startup + 60 секунд
  после завершения; NOWAIT SHARE fence исключает metadata writers при
  проверке live paths/unlink. SQL/COMMIT failure сохраняет jobs; ENOENT
  leaf/lesson идемпотентен только при проверенном root. Файл с live reference
  откладывается; unsafe/symlink/FS errors сохраняются с backoff 60…3600 секунд.
- Нет recursive rm, переиспользования UUID-файлов или стирания failed jobs.
  SQL diagnostics/границы deployment — README/DEPLOY. Старые сироты без
  DELETE metadata, .part/COMMIT reconciliation, квоты и мониторинг места
  остаются DEV-05; клиент и продуктовые правила не меняются.
- Добавлено 29 проверок: 8 без БД, 21 PostgreSQL/API на отдельной schema,
  uploads и advisory namespace. Локально build/PWA и 129/129 без БД прошли.
  CI на fc8a1f7: 372/372 без ошибок/пропусков, все миграции/re-run/оба
  preflight, JUnit gate/summary/artifact, сервер/клиент/PWA и Nginx прошли.
  DEV-05.1 [x], PR #22. Проверенный запуск: https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38356686289
  Перед VDS update нужна миграция/backup/stop всех backend; VDS не менялся.


### DEV-10.1 — события и очередь (2026-10-12)
- Реализованы строгие body/UUID/type/payload/time schemas, 100 событий/64 КиБ,
  PostgreSQL лимит 30 запросов/60 секунд на пользователя, 429 Retry-After.
- Сервер сам определяет user_id; ownerId только сравнивается с сессией.
  User/hierarchy/assignment locks и recheck после ожидания защищают доступ;
  новый backdated event не обходит текущий дедлайн. Записанные дубли ACK
  повторно даже после закрытия доступа; изменение данных того же ID отвергается.
- Миграция 1700000016000: nullable client_event_id, UNIQUE(user_id,eventId),
  per-user rate bucket с cascade. История/серверные события не изменяются.
- Queue v2: отдельные event keys, owner после auth, пакет 100/лимит 2000,
  ID сохраняется до ACK; Beacon не очищает очередь. 15-секундный timeout,
  retry/backoff, частичные ACK, logout/user switch, storage fallback в памяти.
- Время клиента остаётся occurred_at (UTC, недоверенное), время приёма БД —
  created_at; допустимое опережение 5 минут. durationMs bounded int32,
  клиентские события не подтверждают тесты. Heartbeat/проверка длительности
  по серверной паре и browser E2E остаются открытыми; DEV-10 не закрыт целиком.
- Добавлено 40 проверок (22 без БД, 18 SQL/API/migration); локально build/PWA
  и 121/121 без БД прошли. CI на f60a3a8: 343/343 без ошибок/пропусков,
  все миграции/повторный запуск/оба preflight, JUnit gate/summary/artifact,
  сервер/клиент/PWA и Nginx прошли. DEV-10.1 отмечен [x], PR #21.
  Проверенный запуск: https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38255573253
  Сервер/клиент обновлять вместе после миграции, перезагрузить старые вкладки.
  Очередь v1 не имеет владельца/ID и не переносится. VDS не менялся.


### H19 — документация и статусы (2026-10-12)
- Исправлены устаревшие вводные/команды/числа CI и текущие ссылки-приглашения;
  старые этапы отделены от актуального состояния. H01–H06 проверены по коду
  и CI main af820d7 (303/303), статусы HARDENING синхронизированы.
- DEPLOY.md описывает env/первый аккаунт/systemd/Nginx, безопасную очередность
  stop → backup → pull/build/preflight → migrate → publish/start,
  восстановление в отдельной БД и ограничения существующих shell scripts.
- Актуальный backlog в additions выделяет закрытые части и остаток;
  partial SEC-05/DEV-05/DEV-07 не выдаются за полностью завершённые.
- Локально сборка server/client/PWA, links/anchors и bash -n для 24 shell
  blocks прошли; Compose defaults/noEmit/отсутствие generated JS проверены.
  Новых миграций/runtime-изменений нет; VDS не менялся.
  CI PR #20 на 584c1ac: 303/303 без ошибок/пропусков, миграции/повторный
  запуск/оба preflight, JUnit gate/summary/upload, сервер/клиент/PWA
  и Nginx прошли. H19 отмечен [x] в HARDENING.md.
  Проверенный запуск: https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38249337062


### H18 — серверные тесты и CI (2026-10-12)
- Добавлены проверки личных уведомлений/подписок, изоляции, session/Origin,
  ограничения списка/unread и приватной ошибки SQL.
- Test database guard проверен отдельными процессами; JUnit gate отклоняет
  пустые/failure/error/cancel/skip/TODO, включая настоящий Node reporter.
- Actions сохраняет spec/JUnit, summary и artifact 7 дней; прежние job names
  сохранены. Карта тестов/команды/границы — server/tests/README.md.
- Добавлено 16 проверок: 8 PostgreSQL/API и 8 без БД; последние запускают
  guard/checker/Node reporter отдельными процессами, а не только XML fixtures.
- Локально сборка сервер/клиент/PWA, 99/99 без БД и настоящий JUnit gate прошли.
  CI на 671678e: 303/303 без ошибок/пропусков, все миграции/повторный запуск,
  оба preflight, report gate/summary/upload, сборка/PWA и Nginx прошли. H18 [x].
  PR #19: https://github.com/motostrelok1/dvizh-onboardng-sys/pull/19
  CI: https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38241397509
- Artifact имеет номер run_attempt, чтобы rerun не конфликтовал с прежним
  отчётом. Новых миграций нет, VDS/branch protection не менялись;
  browser E2E, реальная push-доставка и аудит зависимостей отдельно.


### H17 — серверная модель попыток (2026-10-12)
- Реализованы атомарные start/answer/finish + events, locks сотрудника/теста/
  попытки и редактора; открытая попытка возобновляется до проверки лимита.
- Вопрос/варианты проверяются по текущему тесту, UUID нормализуются;
  grade пересчитывается на сервере при finish, законченный результат неизменен.
- Политика правок без версионности и «всё или ничего» сохранена по SPEC §3–4.
  Пустой/некорректный тест не расходует попытку. API DTO и клиентские ошибки/
  блокировка кнопок во время запроса добавлены.
- Миграция 1700000015000: номера/one-open UNIQUE и lifecycle/score checks;
  read-only preflight и deployment описаны в README, автоматических repairs нет.
- Локально сборка сервер/клиент/PWA и 91/91 без БД прошли.
  Добавлено 35 проверок (7 без БД, 22 PostgreSQL/API, 6 legacy migration).
  Проверены limit/resume, чужие/некорректные ID, grade/review, доступ/Origin,
  frozen finish, rollback events и контролируемые гонки start/finish/answer/
  editor. Legacy up/down/up сохраняет ID/баллы; конфликты отклоняются.
- CI на 119c35b: 287/287 без ошибок/пропусков, все миграции и повторный
  запуск, H15/H17 preflight, сервер/клиент/PWA и Nginx прошли. H17 [x].
  PR #18: https://github.com/motostrelok1/dvizh-onboardng-sys/pull/18
  CI: https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38239012004
- Перед deployment нужна миграция 1700000015000, backup/окно обслуживания,
  обновление всех backend/клиента вместе. VDS/рабочая БД не менялись;
  request/event dedup остаётся DEV-10.


### H15 — целостность данных (2026-10-12)
- [x] Миграция 1700000014000: UNIQUE tests(scope,parent_id), generated FK
  к модулю/уроку с cascade; nonnegative/unique positions у module/lesson/
  question/attachment. Legacy positions нормализуются с сохранением ID;
  дубли/осиротевшие tests останавливают миграцию без удаления данных.
- Append/reorder сериализуются по родителю, reorder требует полную
  permutation его детей; bulk assignment и events в одной транзакции,
  единый порядок user locks. Read-only preflight CLI и deployment в README.
- Добавлено 26 проверок (2 без БД, 21 API/PostgreSQL, 3 migration isolation).
  Локально сервер/клиент/PWA, 63/63 без БД, синтаксис tests/migration и
  diff --check прошли. CI на 9d49e0a: 216/216 без ошибок/пропусков,
  все миграции/повторный запуск, read-only preflight, сервер/клиент/PWA
  и Nginx прошли. PR #16:
  https://github.com/motostrelok1/dvizh-onboardng-sys/pull/16
  CI: https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38226648135
  Перед обновлением VDS нужна миграция/backup/окно обслуживания;
  VDS/production-БД не менялись. Полная модель попытки — H17, файлы — DEV-05.

### H14 — надёжность загрузки вложений (2026-10-12)
- [x] Private .part до проверки формата, атомарная публикация без overwrite,
  независимые попытки close/unlink, короткая транзакция с recheck/lock урока.
  При ошибке подтверждения COMMIT файл сохраняется для сверки с БД;
  cleanup/commit failures пишут только фиксированные категории.
- Синхронный file/error handler Busboy вместо async req.file() закрывает
  ранние parser errors; весь multipart проверяется, лишние parts отклоняются.
  Версия 3.2.2 уже была в lockfile, теперь закреплена как прямая зависимость.
- Добавлено 13 staging/receiver без БД и 9 PostgreSQL/API-проверок с реальными
  запросами, инъекцией сбоев/коллизиями и контролируемой гонкой удаления.
  Локально сборка сервера/клиента/PWA, 61/61 без БД, синтаксис новых tests
  и diff --check прошли. CI на b81ce67: 190/190 без ошибок/пропусков,
  все миграции/повторный запуск, сервер/клиент/PWA и Nginx прошли.
  PR #15: https://github.com/motostrelok1/dvizh-onboardng-sys/pull/15
  CI: https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38217354418
  Новых миграций нет; VDS не менялся.
- H14 ограничен временной записью и обработкой ошибок. Полный DEV-05
  (квоты/параллельность/свободное место, аварийная сверка/уборка сирот,
  удаление файлов при каскадном DELETE контента) остаётся открыт.

### H13 — семантика PATCH (2026-10-12)
- [x] В admin-users явный departmentId: null очищает отдел, отсутствие
  сохраняет его; в admin-tests отсутствие maxAttempts сохраняет лимит,
  явный null включает безлимит. Атомарные SQL CASE без read/modify/write.
- Добавлено 11 PostgreSQL/API-проверок сохранности полей/credentials,
  очистки/восстановления, false/0, запрещённого null, отката FK и доступа.
  Локально сборка сервера/клиента/PWA, 48/48 без БД, синтаксис новых
  tests и diff --check прошли. CI на c4f7d88: 168/168 без ошибок/пропусков,
  все миграции/повторный запуск, сервер/клиент/PWA и Nginx прошли.
  PR #14: https://github.com/motostrelok1/dvizh-onboardng-sys/pull/14
  CI: https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38207624709
  Новых миграций нет; VDS/рабочая БД не менялись.

### H12 — CSRF и canonical origin (2026-10-12)
- [x] Root guard блокирует unsafe methods при чужом/нет/null/multiple Origin;
  APP_ORIGIN фиксируется из конфигурации, не из Host/Referer/proxy headers.
  В production обязательный HTTPS origin; auth/roles остаются отдельно.
- JSON Blob для pagehide Beacon совместим с no-referrer/Origin; при false
  очередь сохраняется. ACK/dedup событий остаются DEV-10. Deploy preflight
  проверяет service env до client publish/restart.
- Добавлено 8 config/HTTP-проверок, 1 client Beacon и 8 PostgreSQL/API,
  всего 157. Локально прошли сборка сервера/клиента/PWA, 48/48 без БД,
  deploy preflight с временными env (HTTPS/пустой/HTTP/path и приоритет
  service env), bash -n и diff --check. CI на e0f3763: 157/157 без ошибок/
  пропусков, миграции/повторный запуск, сервер/клиент/PWA и Nginx прошли.
  PR #13: https://github.com/motostrelok1/dvizh-onboardng-sys/pull/13
  CI: https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38206489987
- Новой миграции нет; перед production-deploy прописать APP_ORIGIN в
  server/.env с фактическим HTTPS-адресом LMS. Инструкция — README H12.
  VDS/его env не менялись; сервер и клиент обновлять вместе.

### SEC-11 — runtime-валидация API и безопасные ошибки (2026-10-12)
- [x] Строгие JSON Schema body/params/query в auth/admin-users/admin-tests/
  admin-attachments: UUID, типы без coercion, IANA timezone, email/строки,
  passScore 0…100, положительный int32 maxAttempts или null, запрет лишних
  полей. Response DTO исключают внутренние поля и file_path вложения.
- Общий root/route error handler возвращает только фиксированные коды,
  без SQL, stack, путей и parser excerpts. Старые auth/rate/cookie domain
  ответы сохраняются; password checks остаются после account budgets.
- Добавлено 7 проверок без БД и 11 PostgreSQL/API-сценариев; общий набор
  140. Локально прошли сборка сервера/клиента/PWA, 39/39 тестов без БД,
  компиляция всех схем и diff --check. CI на 9b81f4f: 140/140 без ошибок/
  пропусков, миграции/повторный запуск, сервер/клиент/PWA и Nginx прошли.
  PR #12: https://github.com/motostrelok1/dvizh-onboardng-sys/pull/12
  CI: https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38204146306
  Ajv/форматы
  закреплены в зависимостях без смены прежних версий; новой миграции нет.
- VDS/рабочая БД не менялись. DEV-06 PATCH, DEV-01 попытки, CSRF и схемы
  остальных API-модулей — отдельные задачи; SEC-11 охватывает четыре модуля.

### SEC-10 — минимальные health endpoints (2026-10-11)
- [x] /health/tables удалён во всех окружениях и для всех ролей;
  /health и /health/db возвращают только краткий статус, совместимы
  с curl в deploy.sh. Для локального списка таблиц используется psql.
- Health routes вынесены в отдельный production-модуль, подключённый
  из index.ts; 4 новых PostgreSQL/API-сценария проверяют 404 с разными
  сессиями/окружениями без запроса БД, liveness при сбое БД, readiness
  на настоящей БД и минимальный ответ/безопасный лог при ошибке запроса.
- Локально прошли сборка сервера/клиента/PWA, 32/32 теста без БД и проверка
  собранных health routes (liveness, 404, ошибка БД и приватный лог).
  CI на 0fc2759: 122/122 без ошибок/пропусков, все миграции и повторный
  запуск, сервер/клиент/PWA и Nginx успешно проверены.
  PR #11: https://github.com/motostrelok1/dvizh-onboardng-sys/pull/11
  CI: https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38174763295
  Миграции нет, VDS/рабочая БД не менялись.

### SEC-09 — дедлайн при доступе (2026-10-11)
- [x] Срок проверяется по времени PostgreSQL независимо от job и статуса
  при доступе к курсу, уроку, файлу, истории/старту попытки, ответу и finish.
  Завершённые курсы подчиняются сроку по SPEC §5.1; история сохраняется.
- «Мои курсы» показывает фактическую просрочку без UPDATE; job фиксирует
  статус/событие только для незавершённых назначений. Перенос в будущее
  или снятие срока возвращает доступ, перенос в прошлое не обходит проверку.
- Добавлены 19 PostgreSQL/API-сценариев; локально прошли сборка
  сервера/клиента/PWA и 32/32 теста без БД. CI на 778e530: 118/118 без
  ошибок/пропусков, все миграции и повторный запуск, сервер/клиент/PWA
  и настоящий Nginx успешны. Миграции нет; VDS не менялся.
  PR #10: https://github.com/motostrelok1/dvizh-onboardng-sys/pull/10
  CI: https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38170255048
- Проверка при запросе не отменяет уже начатые операции/видеоплеер;
  DEV-08 (таймзона), защита видео и DEV-01 (целостность тестов) вне SEC-09.

### SEC-08 — восстановление доступа и отзыв токенов (2026-10-11)
- [x] Новая ссылка отзывает предыдущие; принятие меняет пароль,
  удаляет старые сессии, отзывает остальные ссылки и создаёт новую
  сессию с событием атомарно.
  Отключение через admin PATCH отзывает доступ; invite не активирует user.
- Общий user lock для issue/accept/revoke/login/session/deactivation,
  READ COMMITTED, NO KEY UPDATE для совместимости FK; expiry проверяется
  после ожидания и после bcrypt. Ошибка откатывает весь credential reset.
- Админка блокирует повторный выпуск/неактивных сотрудников и объясняет
  новую политику; экран приглашения показывает revoked/inactive по-русски.
- 22 новых PostgreSQL/API-сценария; общий набор 99. Локально прошли сборка и 32/32 теста
  без БД. CI на 1fdbe67: 99/99 без ошибок/пропусков, миграции и повторный
  запуск, сервер/клиент/PWA и реальный Nginx успешно проверены.
  PR #9: https://github.com/motostrelok1/dvizh-onboardng-sys/pull/9
  CI: https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38166415857
- Миграции нет; обновлять все экземпляры сервера одновременно, не смешивать
  старый и новый код авторизации. VDS не менялся. Остаток SEC-05/деплой SEC-07 открыт.

### SEC-07 — приглашения и приватные логи (2026-10-11)
- [x] Код: fragment-ссылки и body-only POST API, очистка URL до React,
  безопасные request/error serializers и Pino hook, no-store/no-referrer
  для всех ответов API, политика fetch/HTML и совместимость старых ссылок.
- Nginx example: активный формат без query/Referer/credentials, маска старых
  путей, отсутствие error_log в API/legacy locations, 410 старого API,
  cache off и приватные headers даже при upstream errors. Logrotate: 7 дней.
- Добавлены 6 тестов privacy/URL и 3 PostgreSQL/API-сценария; всего 77.
  Проверки 429/download headers расширены. В CI добавлен реальный Nginx
  с временным upstream для 404/410/502 и анализа access/error logs.
- Локально: 32/32 тестов без БД, сервер/клиент/PWA и diff --check
  успешны. CI на a3ff975: сборка, миграции/повторный запуск, 77/77
  тестов PostgreSQL/API и реальный Nginx (404/410/502, headers/logs) прошли.
  PR #8: https://github.com/motostrelok1/dvizh-onboardng-sys/pull/8
  CI: https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38165125765
- [ ] Применить vhost/retention на VDS и проверить стороннюю telemetry;
  прежние production-логи не исследованы, deploy.sh vhost не обновляет.
  Разворачивать клиент и сервер вместе; старый API удалён без миграции БД.

### SEC-06 — лимиты входа и приглашений (2026-10-11)
- [x] Атомарные PostgreSQL-счётчики по IP/email/токену/пользователю,
  окно 10 минут, 429 с Retry-After до bcrypt; отказы не продлевают окно,
  успешные запросы тоже расходуют бюджет, постоянной блокировки нет.
- Ограничены типы/размеры JSON, email, токена и пароля; новые пароли до
  72 UTF-8 байт, вход с bounded длинными legacy-паролями сохранён.
- Доверие к X-Forwarded-For только от точного loopback peer локального
  Nginx и только к последнему адресу. IPv6 и mapped IPv4 канонизируются.
- Общие счётчики переживают перезапуск; TTL и ограниченная очистка,
  warning при первом отказе без сырого email/IP/токена, формы объясняют 429.
- Добавлены 4 теста IP и 12 PostgreSQL/API-сценариев, общий набор 68.
  Локально сборка сервера/клиента/PWA успешна; результат полного набора
  на PostgreSQL фиксируется в PR после CI.
- Перед запуском обновлённого сервера обязательна миграция
  1700000013000_auth_rate_limits.cjs; deploy.sh уже выполняет migrate.
  Остаток SEC-05 остаётся открытым; код SEC-07 описан выше.

### SEC-05 — проверка формата вложений (2026-10-11)
- [x] Проверка сигнатуры/структуры разрешённых форматов до INSERT;
  MIME как дополнительный сигнал, worker с тайм-аутом и лимитом heap,
  очистка отказа, фиксированный Content-Type/nosniff при скачивании.
- DOCX/XLSX проверяются как контейнер с Content Types, relationships и
  основным XML; лимиты распаковки и отказ DTD/entities. DOC/XLS проверяются
  по OLE и внутренним признакам, PDF разбирается parser-ом. Для PNG/JPEG
  проверяется структура, без полного декодирования пикселей.
- Старые вложения доступны без миграции. Публичного static-route нет;
  Nginx example запрещает /uploads/. UPLOAD_DIR требуется вне web-root.
- Добавлены 11 независимых тестов содержимого и 4 API-сценария; всего 52.
  PDF decoder ограничен до выделения буфера: 16 МиБ на поток, бюджет
  выделений 64 МиБ; используется адаптер к pinned pdf-lib 1.17.1.
  Локально: 22/22 быстрых тестов, сборка сервера/клиента/PWA и запуск
  скомпилированного worker успешны. PostgreSQL integration-проверка
  выполняется в CI и фиксируется в PR.
- PR #6: https://github.com/motostrelok1/dvizh-onboardng-sys/pull/6
- [ ] Остаток SEC-05: согласовать политику макросов, антивирус и карантин.
  Проверка формата не является доказательством отсутствия вредоносного
  содержимого. Полный SEC-05 не отмечен закрытым.

### SEC-04 — безопасные пути вложений (2026-10-11)
- Новые имена на диске: UUID + разрешённое расширение; оригинальное имя
  остаётся в метаданных. UUID и существование урока проверяются до mkdir.
- Проверки resolve/relative, каталога урока и symlink при создании,
  скачивании и удалении. Создание: O_EXCL/O_NOFOLLOW, файлы 0600,
  новые каталоги 0700. Обычные старые имена поддерживаются без миграции.
- Незавершённая/слишком большая загрузка очищается; запросы с путями
  вне хранилища отклоняются без чтения/удаления внешнего файла.
- Добавлены 11 тестов хранилища и 10 integration-сценариев. Общий набор:
  37 тестов, включая прежние 16 тестов авторизации; защита тестовой БД
  вынесена в общий helper без изменения правил.
- Локально: 11/11 тестов хранилища и сборка сервера/клиента/PWA успешны.
  Результат PostgreSQL integration-проверки фиксируется в PR после CI.
- Код подготовлен в PR #5: https://github.com/motostrelok1/dvizh-onboardng-sys/pull/5
- Граница защиты: uploads меняет только сервис LMS; проверки пути
  не устраняют гонку с другим локальным процессом с теми же правами.
  SEC-05 и полный DEV-05 остаются открытыми.


### CI и первые regression-тесты (2026-10-11)
- Добавлен `.github/workflows/ci.yml`: PR, push в main, ручной запуск;
  Node.js 24, npm ci, отдельные jobs сборки и PostgreSQL integration-тестов.
- Вместо `dist_test_placeholder` — 16 тестов настоящих маршрутов через
  Fastify inject и отдельную PostgreSQL: авторизация, роли, SEC-01/02,
  приглашения и изоляция назначенного курса. Все миграции применяются
  в CI к одноразовой БД и повторно проверяются на уже обновлённой БД.
- `npm run build` собирает оба workspace; `npm test` запускает тесты
  сервера. Инструкции и границы покрытия добавлены в README.
- Проверено: npm ci и сборка сервера/клиента/PWA прошли локально;
  GitHub Actions на коммите 6dc5515: обе проверки успешны, все миграции
  применены, повторный запуск без новых миграций, 16/16 тестов прошли
  без пропусков. Запуск: https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38153621212
- На момент первой записи оставались тесты попыток/файлов/дедлайнов/гонок.
  Они добавлены H07–H18; browser UI/E2E и branch protection отдельно.
  CI не выполняет деплой и не использует рабочую БД.

- Видеохостинг: пока не выбран (SPEC.md §11.1, §11.2)
- Пороги аналитики: стартовые значения из SPEC.md §9.1
- Открытые вопросы: см. SPEC.md §18


### H16 — защита планировщиков (2026-10-12)

- Реализованы общие PostgreSQL session advisory locks для deadlines/reports/
  notifications, атомарные записи и общий путь manual/login/schedule.
- Таймеры последовательны, повтор после ошибки возможен в том же дне;
  SIGINT/SIGTERM drain jobs и закрывают pool после текущих работ.
- Push выполняется после COMMIT под тем же lock; при ошибке доставки запись
  сохраняется. Exactly-once/outbox/retry и новые идемпотентные ключи не закрыты
  этим изменением; ограничения и deployment описаны в README.
- Добавлено 36 проверок: 21 runner/scheduler/shutdown/безопасные ошибки/
  transaction executor без БД и 15 PostgreSQL/API на отдельной схеме/ключах.
  Проверены межпроцессная конкуренция, разные lanes, terminate backend,
  rollback status/event и частичных reports/backfill, повтор в тот же день,
  сохранённая dedup, COMMIT перед push/lock до окончания, Origin и доступ.
- Локальная сборка сервера/клиента/PWA и pure-проверки прошли. CI на abfdb9e:
  252/252 без ошибок/пропусков, миграции/повторный запуск, H15 preflight,
  сервер/клиент/PWA и Nginx прошли. H16 отмечен [x] в HARDENING.md.
  Проверенный запуск: https://github.com/motostrelok1/dvizh-onboardng-sys/actions/runs/38236073041
- PR #17. Новых миграций нет; VDS/рабочая БД не менялись. Полный DEV-07
  (outbox, новые idempotency keys, retry/backoff/мониторинг) остаётся открыт.

## Новая задача: BlockNote — 2026-10-15

- [x] BN-00: решение по редактору принято — BlockNote, self-hosted, бесплатная open-source основа.
- [x] BN-00.1: создана полная спецификация `docs/BLOCKNOTE-SPEC.md` и разбивка на этапы.
- [ ] BN-01: оценка и установка зависимостей, совместимость React 18, license/security и lockfile rollout.
- [ ] BN-02: JSONB/API/валидация и сохранение текстов старых уроков; миграция только вручную.
- [ ] BN-03: сам редактор BlockNote + русский UX.
- [ ] BN-04: единый безопасный read-only renderer в кабинете сотрудника и preview.
- [ ] BN-05: загрузка фотографий, эмодзи и безопасное media-хранилище.
- [ ] BN-06: учебные блоки, авто-сохранение, мобильная доступность.
- [ ] BN-07: E2E и приёмка. Подробнее: [docs/BLOCKNOTE-SPEC.md](docs/BLOCKNOTE-SPEC.md).
