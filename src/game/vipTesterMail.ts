/** VIP5 tester gift mail (not sent by deploying this file).
 * Only a later owner-approved, idempotent admin mail transaction may create a
 * server admin_grants row. VIP entitlement was separately granted already.
 */
export const VIP_TESTER_MAIL_SUBJECT='👑 VIP 5 — благодарность за развитие TERRITORY';

export function vipTesterMailBody(username:string,language:'ru'|'en'):string {
  const recipient=username.startsWith('@')?username:'@'+username;
  if(language==='en')return `Dear ${recipient},

The TERRITORY team personally thanks you for the time, dedication, and honest feedback you have contributed to our game.

Your testing, ideas, and attention to detail help us make the world of TERRITORY better for every player. You are among the heroes who have supported us from the beginning.

👑 In recognition of your contribution, your permanent VIP Level 5 has already been activated.
🎁 An additional thank-you gift awaits you in this letter. Tap “Claim Gift” to collect its contents.

Your support means a great deal to our growing team. We look forward to many more adventures together.

With gratitude,
The TERRITORY Team`;
  return `Дорогой ${recipient}!

Команда TERRITORY искренне благодарит тебя за время, силы и внимание, которые ты вложил в развитие нашей игры.

Твои проверки, предложения и честные замечания помогают нам становиться лучше. Именно благодаря таким людям, как ты, мир TERRITORY растёт, а каждый новый герой получает более интересное и качественное приключение.

👑 В знак признательности мы навсегда присвоили тебе VIP 5 уровня.
🎁 В этом письме тебя ждёт дополнительный подарок. Нажми «Получить подарок», чтобы забрать его содержимое.

Мы ценим твой вклад и рады, что ты с нами с самого начала. Впереди ещё много новых приключений и побед!

С уважением и благодарностью,
Команда TERRITORY`;
}
export function localizedVipTesterMail(
  mail:{subject:string;body:string},
  language:'ru'|'en',
):{subject:string;body:string}{
  if(mail.subject!==VIP_TESTER_MAIL_SUBJECT)return {subject:mail.subject,body:mail.body};
  // The stored body embeds the original addressed @handle on its greeting.
  const handle=mail.body.match(/@[A-Za-z0-9_]+/)?.[0] ?? '@Hero';
  return language==='en'
    ? {subject:'👑 VIP 5 — Thank you for helping TERRITORY grow',
        body:vipTesterMailBody(handle,'en')}
    : {subject:mail.subject,body:mail.body};
}
