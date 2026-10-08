// Разовый скрипт: генерирует пару ключей для web push и печатает, что
// добавить в .env. Выполнить один раз при разворачивании, ключи сохраняются
// в .env и не меняются (иначе все существующие push-подписки станут
// нерабочими — сотрудникам придётся заново включать уведомления).
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log("Добавьте в server/.env:\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:admin@example.com`);
