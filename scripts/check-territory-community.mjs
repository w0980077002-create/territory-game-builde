import assert from "node:assert/strict";
import { classifyMessage, formatAlert, messageLink, messageText } from "../supabase/functions/territory-community/rules.mjs";

assert.equal(classifyMessage("Бро, пропали алмазы!").priority, "P0");
assert.equal(classifyMessage("I can't login to my account").priority, "P0");
assert.equal(classifyMessage("không đăng nhập được").priority, "P0");
assert.equal(classifyMessage("В испытаниях ошибка, не сохраняет").priority, "P1");
assert.equal(classifyMessage("Предлагаю изменить задание босса").category, "suggestion");
assert.equal(classifyMessage("лимит ударов на боссе").category, "balance");
assert.equal(classifyMessage("Привет, добро пожаловать!").priority, "P3");
assert.deepEqual(classifyMessage(""), classifyMessage("обычная переписка"));
assert.equal(messageLink({ id: -1001234567890 }, 42), "https://t.me/c/1234567890/42");
assert.equal(messageLink({ id: -1001234567890, username: "TerritoryOfficial" }, 7), "https://t.me/TerritoryOfficial/7");
assert.equal(messageLink({ id: -123 }, 7), null);
assert.equal(messageLink({ id: -1001234567890 }, -1), null);
assert.equal(messageText({ caption: "  тест подписи " }), "тест подписи");
const alert = formatAlert({ from: { username: "TestPlayer" }, text: "не могу зайти" },
  classifyMessage("не могу зайти"), "https://t.me/c/123/1");
assert.ok(alert.includes("@TestPlayer"));
assert.ok(alert.includes("https://t.me/c/123/1"));
console.log("TERRITORY community rules: 15 checks passed");
