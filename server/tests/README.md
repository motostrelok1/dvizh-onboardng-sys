# Серверные проверки

`npm test` из корня запускает настоящий Node test runner + tsx. Все SQL/API
проверки используют Fastify inject, production-модули маршрутов и отдельную
мигрированную PostgreSQL. index.ts не импортируется: HTTP listener и таймеры
не стартуют автоматически. Имитации используются для контролируемого сбоя
или остановки запроса; SQL и проверки транзакций выполняются настоящей БД.

| Область | Файлы | Что проверяется |
| --- | --- | --- |
| Вход, приглашения, сессии, роли | auth.integration, auth-recovery.integration, auth-rate-limit.integration | 401/403, отключение, expiry/revocation, атомарность, лимиты, конкуренция |
| Приватность и API | api-validation, csrf, privacy, health (+ integration) | строгие схемы, safe errors/DTO, Origin, no-store, приватные логи |
| Файлы | storage, file-content, attachments.integration, upload-staging, upload-receiver, upload-reliability.integration | структура/пути, symlink/коллизии, multipart/обрыв, rollback/COMMIT ambiguity |
| Дедлайны и доступ | deadlines.integration | время БД, completed/overdue, перенос, чужая попытка, job event |
| Контент/назначения | data-integrity.integration, content-integrity-migration.integration, patch.integration | parent/position locks, constraints/cascade, атомарные assignments, PATCH missing/null |
| Попытки | test-attempts, test-attempts.integration, attempt-integrity-migration.integration | лимит/resume, принадлежность ID, live grading, frozen finish, гонки, migration up/down |
| Планировщики/отчёты/push transport | jobs, jobs.integration | общий lock, serial retry/drain, atomic backfill, COMMIT до push, сохранённая dedup |
| Личные уведомления/подписки | notifications.integration | только свои данные, latest-50/unread, read идемпотентно, scoped deletion, inactive/expired/Origin |
| Тестовая среда/отчёт | test-database-guard, ci-results | отказ при неверной БД, реальный Node JUnit, empty/failure/error/skip/TODO, summary |

В таблице опущен суффикс `.test.mjs`. Это карта сценариев, не процент покрытия
всего кода. Не покрыты browser E2E/UI и реальная доставка push устройству.
Часовые пояса, outbox/retry доставки, event dedup/access (DEV-10), антивирус,
сверка файлов после аварии и аудит зависимостей остаются отдельными задачами.

## Запуск SQL-проверок

Используйте одноразовую локальную БД, имя которой оканчивается `_test`:

```bash
export DATABASE_URL='postgres://USER:PASSWORD@127.0.0.1:5432/lms_test'
export TEST_DATABASE_URL="$DATABASE_URL"
export NODE_ENV=test
npm ci
npm run migrate --workspace server
npm test
```

Замените USER/PASSWORD на данные именно тестовой БД. Guard не использует
DATABASE_URL как fallback: TEST_DATABASE_URL обязателен, допустимы только
localhost/127.0.0.1/IPv6 loopback и postgres/postgresql. Проверки чистят только
собственные UUID; legacy DDL — в случайной rollback-схеме, jobs — в отдельной
схеме и namespace lock. Ни рабочая БД, ни VDS не нужны для CI.

## CI и диагностика

Actions запускается на PR, main и вручную. Jobs сохраняют прежние имена:
`Server and client build`, `PostgreSQL and auth tests`. Первая собирает оба
workspace/PWA и проверяет настоящий Nginx. Вторая применяет все миграции,
повторяет migrate и оба read-only preflight, затем выполняет `test:ci`.

`npm run test:ci --workspace server` выдаёт spec-лог и
`server/test-results.xml`. Команда `node server/scripts/check-test-results.mjs server/test-results.xml` отклоняет отсутствие/невалидный/пустой отчёт,
failed/error/cancelled/skip/TODO. Отчёт и числовая summary не подменяют exit
code runner: упавший тестовый шаг остаётся ошибкой.

На GitHub откройте PR → Checks → PostgreSQL and auth tests → Details.
Числа есть в Summary запуска; в Artifacts сохранён `server-test-results-1` (номер попытки запуска в конце имени)
на 7 дней, включая отчёт неудачного прогона. Credentials/.env и файлы
uploads не включаются в artifact. Автоматического deployment нет.
Обязательность Checks для main задаётся отдельно настройками репозитория;
этот PR не меняет branch protection. Клиентские E2E/аудит зависимостей
не выдаются за выполненные серверные regression-проверки.
