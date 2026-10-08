import { pool } from "../db.js";
import { createNotification } from "../notifications.js";

type Rule = {
  id: string;
  course_id: string | null;
  kind: "before_deadline" | "on_deadline" | "overdue";
  offset_days: number;
  channel: "in_app" | "push";
  is_active: boolean;
};

function daysUntil(deadline: Date): number {
  return (deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
}
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Правила по умолчанию (SPEC §5.1: «например, за 7 и за 1 день, в день
// дедлайна, при просрочке»), создаются один раз, если админ ещё не настроил
// ни одного правила. courseId = null — действует для всех курсов.
async function seedDefaultRulesIfEmpty() {
  const countRes = await pool.query(`select count(*)::int as n from notification_rules`);
  if (countRes.rows[0].n > 0) return;

  const defaults: Array<[string, number, string]> = [
    ["before_deadline", 7, "in_app"],
    ["before_deadline", 7, "push"],
    ["before_deadline", 1, "in_app"],
    ["before_deadline", 1, "push"],
    ["on_deadline", 0, "in_app"],
    ["on_deadline", 0, "push"],
    ["overdue", 0, "in_app"],
    ["overdue", 0, "push"]
  ];
  for (const [kind, offset, channel] of defaults) {
    await pool.query(
      `insert into notification_rules (course_id, kind, offset_days, channel) values (null, $1, $2, $3)`,
      [kind, offset, channel]
    );
  }
}

// Уже отправляли сегодня уведомление по этому правилу для этого назначения?
// (для overdue — не «сегодня», а когда-либо: статус overdue не меняется
// сам по себе, повторно слать незачем)
async function alreadySent(assignmentId: string, rule: Rule): Promise<boolean> {
  if (rule.kind === "overdue") {
    const res = await pool.query(
      `select 1 from notifications where assignment_id = $1 and kind = 'overdue' and channel = $2 limit 1`,
      [assignmentId, rule.channel]
    );
    return res.rows.length > 0;
  }
  const res = await pool.query(
    `select 1 from notifications
     where assignment_id = $1 and kind = $2 and channel = $3 and sent_at::date = current_date
     limit 1`,
    [assignmentId, rule.kind, rule.channel]
  );
  return res.rows.length > 0;
}

export async function checkAndSendNotifications(): Promise<number> {
  await seedDefaultRulesIfEmpty();

  const rulesRes = await pool.query(`select * from notification_rules where is_active = true`);
  const rules: Rule[] = rulesRes.rows;
  if (rules.length === 0) return 0;

  let sent = 0;

  for (const rule of rules) {
    const statusList = rule.kind === "overdue" ? ["overdue"] : ["assigned", "in_progress"];

    const assignRes = await pool.query(
      `select a.*, c.title as course_title from assignments a join courses c on c.id = a.course_id
       where a.deadline is not null and a.status = any($1)
         and ($2::uuid is null or a.course_id = $2)`,
      [statusList, rule.course_id]
    );

    for (const a of assignRes.rows) {
      const deadline = new Date(a.deadline);
      let matches = false;

      if (rule.kind === "before_deadline") {
        matches = Math.floor(daysUntil(deadline)) === rule.offset_days;
      } else if (rule.kind === "on_deadline") {
        matches = toDateStr(deadline) === toDateStr(new Date());
      } else {
        matches = true; // overdue: сам фильтр по статусу уже отобрал нужные
      }

      if (!matches) continue;
      if (await alreadySent(a.id, rule)) continue;

      const title =
        rule.kind === "before_deadline"
          ? `Скоро дедлайн: «${a.course_title}»`
          : rule.kind === "on_deadline"
            ? `Сегодня дедлайн: «${a.course_title}»`
            : `Доступ к курсу «${a.course_title}» закрыт`;
      const body =
        rule.kind === "before_deadline"
          ? `Осталось ${rule.offset_days} дн. до окончания срока прохождения`
          : rule.kind === "on_deadline"
            ? "Сегодня последний день, когда курс ещё доступен"
            : "Срок прохождения истёк";

      await createNotification(a.user_id, a.id, rule.kind, rule.channel, title, body);
      sent++;
    }
  }

  return sent;
}

export function startNotificationScheduler(intervalMs = 60 * 60_000) {
  const run = () => {
    checkAndSendNotifications().catch((err) => console.error("Ошибка рассылки уведомлений:", err));
  };
  run();
  return setInterval(run, intervalMs);
}
