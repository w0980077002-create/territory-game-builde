// Pure Telegram community helpers; no secrets or I/O.
const has = (text, phrases) => phrases.some((phrase) => text.includes(phrase));

export function classifyMessage(input) {
  const text = String(input || "").toLocaleLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();
  const urgent = [
    "не могу зайти", "не могу войти", "не заходит в игру", "все пропало",
    "всё пропало", "пропали алмазы", "пропал прогресс", "сбросился аккаунт",
    "сбросился прогресс", "деньги списали", "платёж не прошёл", "платеж не прошел",
    "списали деньги", "взломали аккаунт", "украли аккаунт", "массовый сбой",
    "can't login", "cannot log in", "lost my progress", "lost my account",
    "missing diamonds", "payment failed", "hacked account",
    "không đăng nhập được", "mất tài khoản", "mất kim cương", "mất tiến trình",
    "не могу заплатить", "не начислили покупку"
  ];
  if (has(text, urgent)) return { category: "access_or_loss", priority: "P0", reason: "Возможная потеря доступа, ресурсов или платёжная проблема" };

  const bug = [
    "ошибка", "баг", "сломал", "сломалось", "не работает", "лагает", "лагать",
    "зависает", "вылетает", "не сохраняет", "не засчитали", "не засчитало",
    "bug", "error", "glitch", "crash", "doesn't work", "not working",
    "bị lỗi", "không hoạt động", "không nhận được"
  ];
  if (has(text, bug)) return { category: "bug_report", priority: "P1", reason: "Возможная ошибка игры" };

  const ideas = [
    "предлагаю", "добавьте", "сделайте", "хочу чтобы", "хочу, чтобы",
    "было бы круто", "лучше убрать", "стоит убрать", "suggest", "please add",
    "should add", "please remove", "đề xuất", "nên thêm", "nên bỏ", "muốn thêm"
  ];
  if (has(text, ideas)) return { category: "suggestion", priority: "P2", reason: "Предложение игрока" };

  const balance = [
    "баланс", "сильный босс", "слабый босс", "слишком быстро", "слишком сложно",
    "лимит ударов", "шанс выпадения", "too strong", "too weak", "balance",
    "boss quá mạnh", "quá khó", "quá dễ"
  ];
  if (has(text, balance)) return { category: "balance", priority: "P2", reason: "Обсуждение игрового баланса" };

  return { category: "general", priority: "P3", reason: "Обычное сообщение или недостаточно данных" };
}

export function messageLink(chat, messageId) {
  if (!Number.isSafeInteger(messageId) || messageId <= 0) return null;
  const username = chat && typeof chat.username === "string" ? chat.username : "";
  if (/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(username))
    return "https://t.me/" + username + "/" + messageId;
  const id = String(chat && chat.id !== undefined ? chat.id : "");
  if (/^-100\d+$/.test(id)) return "https://t.me/c/" + id.slice(4) + "/" + messageId;
  return null;
}

export function messageText(msg) {
  if (!msg || typeof msg !== "object") return "";
  const value = typeof msg.text === "string" ? msg.text : typeof msg.caption === "string" ? msg.caption : "";
  return value.trim().slice(0, 3500);
}

export function formatAlert(msg, analysis, link) {
  const user = msg.from && msg.from.username ? "@" + String(msg.from.username).slice(0, 64) : "ID " + String(msg.from?.id ?? "unknown");
  const text = messageText(msg).slice(0, 700);
  return [
    "🚨 TERRITORY AI · ВАЖНО",
    "Тип: " + analysis.category,
    "Причина: " + analysis.reason,
    "Игрок: " + user,
    "Сообщение: " + text,
    link ? "Оригинал: " + link : "Ссылка недоступна"
  ].join("\n");
}
