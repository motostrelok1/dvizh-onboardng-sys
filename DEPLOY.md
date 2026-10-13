# Развёртывание LMS

Это инструкция для `motostrelok1/dvizh-onboardng-sys`. Домен, SSH-доступ и
фактические пути VDS не подтверждены. Значения `/opt/lms`, `lms`,
`/var/www/lms/client-dist` и `edu.example.ru` ниже — примеры, которые нужно
заменить своими. CI проверяет код и одноразовую БД, deployment не выполняет.

## Подготовка сервера

Нужны Node.js 24 для терминала **и** `/usr/bin/node` из lms.service,
PostgreSQL 16/доступ к БД, клиентские pg_dump/pg_restore, Nginx с рабочим
HTTPS, Git, npm и rsync. Версию Node для проекта задаёт [.nvmrc](.nvmrc).
Секреты задаются в `server/.env`; root `.env` нужен только для Compose.
Изменение POSTGRES_PASSWORD в env не меняет пароль уже созданной БД.

В SSH-терминале откройте папку LMS и настройте переменные под ваш сервер:

```bash
export APP_DIR=/opt/lms
export SERVICE_NAME=lms
export WEB_ROOT=/var/www/lms/client-dist
export UPLOAD_DIR=/opt/lms/server/uploads
export BACKUP_DIR=/var/backups/lms
cd "$APP_DIR"
```

UPLOAD_DIR должен быть абсолютным, вне WEB_ROOT; backup.sh не читает его
из server/.env автоматически. В примерном service WorkingDirectory равен
`/opt/lms/server`, поэтому `./uploads` из env означает эту же папку.
При другой папке измените EnvironmentFile, WorkingDirectory и обе
ReadWritePaths в [deploy/lms.service](deploy/lms.service).
До установки unit создайте сервисного пользователя вашей установки
(в примере lms); он не создаётся lms.service автоматически.
Код/конфигурация должны читаться пользователем сервиса, uploads/logs —
существовать и быть доступны ему для записи. Не применяйте `chmod 777`.

При первой установке скопируйте env (при обновлении сохраните существующий):

```bash
cp server/.env.example server/.env
nano server/.env
```

Заполните DATABASE_URL с URL-кодированным паролем своей БД, UPLOAD_DIR,
PORT и адрес приложения. Для production:

```dotenv
NODE_ENV=production
PORT=3000
APP_ORIGIN=https://edu.example.ru
UPLOAD_DIR=/opt/lms/server/uploads
```

Адрес должен совпадать с браузером/Nginx, без /api, пути и fragment.
DATABASE_URL храните без внешних кавычек и `export`: backup.sh читает строку
простым grep/cut, а systemd и dotenv читают тот же файл. Ограничьте чтение
.env владельцем сервиса/оператором, не коммитьте его и не выводите в общие логи.
Для push выполните `npm run vapid:generate --workspace server`, затем
внесите обе VAPID-строки и VAPID_SUBJECT в env. Реальное получение push
нужно проверить в HTTPS-браузере отдельно.

Backend сейчас слушает **0.0.0.0:PORT**, а не только loopback. Настройте
firewall так, чтобы снаружи были доступны HTTPS/нужный SSH, но не PORT
backend и не PostgreSQL. Compose публикует БД только на 127.0.0.1; проверка
реальной внешней доступности и прав DB-role остаётся задачей оператора.

## Первый запуск на новой пустой БД

Убедитесь, что БД создана и доступна. В корне репозитория:

```bash
unset DATABASE_URL TEST_DATABASE_URL APP_ORIGIN
npm ci &&
npm run migrate --workspace server &&
npm run check:content-integrity --workspace server &&
npm run check:attempt-integrity --workspace server &&
npm run build
```

Команды migrate/preflight читают server/.env. Не запускайте npm test на
рабочей БД: правила тестовой среды — [server/tests/README.md](server/tests/README.md).
Создайте первого администратора (имя/email замените своими):

```bash
npm run seed:admin --workspace server -- "Имя Фамилия" admin@example.com
npm run invite --workspace server -- USER_UUID
```

Вместо USER_UUID вставьте UUID, выданный seed:admin. Сохраните ссылку
`https://ВАШ-ДОМЕН/invite#ТОКЕН` из вывода invite; откройте её **после**
публикации клиента/запуска сервиса и настройки HTTPS ниже, затем задайте пароль.
Это bootstrap первого аккаунта; последующие сотрудники и ссылки создаются
в админке «Сотрудники». Seed не является идемпотентным: повторно не запускайте
для существующего email. Вывод invite содержит действующий секрет.

Опубликуйте клиент:

```bash
mkdir -p "$WEB_ROOT" && rsync -a --delete "$APP_DIR/client/dist/" "$WEB_ROOT/"
```

WEB_ROOT содержит только сборку LMS, лишние файлы удаляются. Откройте
`sudo nano /etc/systemd/system/lms.service`, скопируйте туда
[пример unit](deploy/lms.service), замените пользователя/абсолютные пути
под свою установку. Создайте uploads/logs до
запуска unit; если PostgreSQL в Docker, адаптируйте After/Wants под своё
размещение. Затем `sudo systemctl daemon-reload` и
`sudo systemctl enable --now "$SERVICE_NAME"`.

Адаптируйте [Nginx example](deploy/nginx.conf.example): домен, сертификаты,
root и upstream PORT. Пример с незаполненными ssl_certificate не готов к
запуску; сначала подготовьте HTTPS и корректные пути сертификатов по
процедуре вашего сервера. Map/log_format подключаются внутри http{},
сохраняйте приватные locations/headers. Проверьте `sudo nginx -t`, затем
`sudo systemctl reload nginx`. deploy.sh vhost не устанавливает.

## Обновление существующей установки

На GitHub откройте PR → Checks и дождитесь обеих зелёных jobs, затем Merge.
На VDS заранее проверьте пути/env/права и наличие PostgreSQL client tools.
В окно обслуживания остановите **все** backend/worker экземпляры, чтобы
старый и новый auth/editor/jobs код не работали вместе. Для одного unit:

```bash
cd "$APP_DIR"
git status --short
git branch --show-current
git rev-parse HEAD
sudo systemctl stop "$SERVICE_NAME"
sudo systemctl is-active "$SERVICE_NAME"
```

Последняя команда должна показать inactive (её exit code при этом ненулевой).
Если есть локальные изменения, сохраните/разберите их до обновления. Запишите
прежний SHA и миграции в запись обслуживания. На main с чистыми tracked files:

```bash
unset DATABASE_URL TEST_DATABASE_URL APP_ORIGIN
umask 077
test -d "$UPLOAD_DIR" &&
APP_DIR="$APP_DIR" UPLOAD_DIR="$UPLOAD_DIR" BACKUP_DIR="$BACKUP_DIR" bash deploy/backup.sh
```

Проверьте пару `db-STAMP.dump` / `uploads-STAMP.tar.gz` с одинаковым STAMP.
Скрипт пропускает отсутствующую папку uploads, поэтому одного exit 0
недостаточно: нужен архив ожидаемого хранилища. KEEP_DAYS по умолчанию 14,
ротация удаляет старые копии подходящих имён. Храните резервные копии вне
web-root с ограниченным доступом; env/сертификаты/systemd/DB-роли этот
скрипт не сохраняет, их нужно сохранить отдельно в защищённом месте.

```bash
git pull --ff-only origin main &&
npm ci &&
npm run check:content-integrity --workspace server &&
npm run check:attempt-integrity --workspace server &&
npm run build &&
node --input-type=module -e '
import { config } from "dotenv";
import { configuredOrigin } from "./server/dist/csrf.js";
const env = config({ path: "server/.env" });
if (env.error) throw new Error("Cannot read server/.env");
configuredOrigin(env.parsed?.APP_ORIGIN ?? "", true);
'
```

При ошибке любого шага остановитесь и не переходите к следующему.
H15 migration `1700000014000` нормализует старые positions, блокирует
duplicate/orphan tests; H17 `1700000015000` блокирует duplicate/open/invalid
attempts. Preflight ничего не чинит/не удаляет и работает до миграций;
миграция повторно проверяет ограничения под lock. Если таблиц ещё нет,
это не сценарий обновления полной LMS: используйте новую пустую БД/первый
запуск или отдельно подготовленный переход со своей старой схемы.

После успешного preflight/backup/build/config-check:

```bash
npm run migrate --workspace server &&
npm run check:content-integrity --workspace server &&
npm run check:attempt-integrity --workspace server &&
mkdir -p "$WEB_ROOT" &&
rsync -a --delete "$APP_DIR/client/dist/" "$WEB_ROOT/" &&
sudo systemctl start "$SERVICE_NAME" &&
sudo systemctl --no-pager --full status "$SERVICE_NAME"
```

Эта последовательность обходится без git reset. Существующий
[deploy/deploy.sh](deploy/deploy.sh) сам делает checkout/reset --hard,
миграции, сборку, публикацию и restart; он **не** делает stop всех экземпляров
или backup, а APP_ORIGIN проверяет после миграций. Используйте его только
после внешней подготовки/backup/проверок и с сохранёнными локальными
изменениями. WEB_ROOT/SERVICE_NAME/APP_DIR передаются через окружение;
его health curl жёстко использует порт 3000. При другом PORT проверяйте его
вручную и настройте upstream. Скрипт H19 не менялся.

## Проверка после запуска

Для PORT=3000 локально должны отвечать health и БД:

```bash
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/health/db
```

По публичному HTTPS проверьте вход, роль сотрудника/админа, приглашение,
урок/вложение, попытку теста и уведомления. Сотрудник не должен получать
чужой курс/уведомления; после отключения старая cookie должна получать 401.
/api/health/tables и /uploads/ должны давать 404, приватные API — no-store.
Проверьте manifest/sw/иконки и обновление уже установленной PWA.
Права/retention Nginx/journald, real push, firewall и восстановление backup
не подтверждаются одной зелёной проверкой CI.

## Backup, проверка восстановления и rollback

Ежедневный backup/cron и пример retention описаны в [backup.sh](deploy/backup.sh).
Без остановки writes SQL dump и архив uploads сняты в разные моменты;
для согласованной копии перед миграцией используйте окно обслуживания выше.

Для проверки восстановите **свою** копию в заранее созданную пустую локальную
БД `lms_restore_check_test`; используйте отдельный URI и приватный каталог:

```bash
export RESTORE_DATABASE_URL='postgres://USER:URL_ENCODED_PASSWORD@127.0.0.1:5432/lms_restore_check_test'
export STAMP=ЗНАЧЕНИЕ_ИЗ_ИМЕНИ_ПАРЫ_BACKUP
pg_restore --single-transaction --no-owner --no-privileges --dbname="$RESTORE_DATABASE_URL" < "$BACKUP_DIR/db-$STAMP.dump" &&
mkdir -p "$BACKUP_DIR/restore-check/$STAMP" &&
tar -xzf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "$BACKUP_DIR/restore-check/$STAMP" &&
psql "$RESTORE_DATABASE_URL" -c 'select count(*) from users; select count(*) from lesson_attachments;'
```

Проверьте реальные строки и чтение нескольких вложений из распакованного
архива. Восстановленная БД содержит прежние абсолютные file_path; для
полноценного изолированного запуска нужно согласовать эти пути и env,
не направлять тестовый backend на production uploads/jobs. Проверка выше
не восстанавливает working VDS и не заменяет проверку приложения.
Описание опций: [PostgreSQL 16 pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html).

Если обновление не прошло, оставьте сервис остановленным, сохраните
диагностику/резервную пару и определите совместимость старого кода со схемой.
При совместимой схеме верните записанный SHA в чистой рабочей копии,
выполните npm ci/build, опубликуйте соответствующий клиент и запустите unit.
После H15 старый неоднозначный порядок нельзя вернуть обычным migrate:down;
down H17 снимает ограничения, но не отменяет новые данные. Не запускайте
цепочку down вслепую. Если нужен rollback данных, восстановление backup
потеряет записи после его момента: сначала выберите согласованную пару
БД/вложений и процедуру переключения, протестируйте её в изолированной БД.
Автоматического overwrite рабочей БД эта инструкция не выполняет.


## Обновление DEV-10.1

После PR #21 также обязательна миграция 1700000016000_client_event_integrity.cjs:
nullable client_event_id + UNIQUE owner/id, event_rate_limits. Старый журнал
сохраняется; отдельного repair/preflight для этой additive migration нет.
Применить по процедуре stop/backup/migrate выше, обновить все backend и клиент
вместе, перезагрузить старые вкладки и PWA. Несовместимые старые запросы events
получают 400, а queue v1 без owner/ID не переносится. Down удаляет метаданные
дедупликации и bucket; откат к старому приёму повторов может удвоить события.
Подробный протокол/лимиты/границы очереди — [README](README.md#dev-101-события-урока-и-очередь).


## Обновление DEV-05.1

PR #22 требует миграцию 1700000017000_attachment_file_cleanup.cjs: durable
queue и transactional AFTER DELETE trigger. Применить по stop/backup/migrate
процедуре выше, обновить все backend вместе. Клиент не меняется. Очередь
содержит абсолютные пути: сохраняйте рабочий UPLOAD_DIR, shared filesystem
и права удаления; при недоступном root задачи останутся для retry.

Не очищать queue/TRUNCATE вручную и не отключать trigger. Down отказывается
выполняться с pending jobs. Старые сироты не backfill-ятся автоматически.
До backup/restore остановить все worker/backend; восстанавливать согласованную
пару DB/uploads в тех же путях, проверить live rows и pending queue перед start.
Миграция не удаляет файлы; новый scheduler обрабатывает ранее committed jobs
сразу после listen. Диагностика без имён/путей — [README](README.md#dev-051-очистка-удалённых-вложений).
