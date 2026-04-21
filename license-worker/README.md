# E-Savdo litsenziya Worker (Cloudflare)

Obuna so‘rovlari Telegram orqali adminga boradi; inline tugmalar bilan tasdiqlangach KV da litsenziya yoziladi, dastur `/api/verify` orqali ochiladi.

## Rejalar (worker ichida)

| `plan` (API)   | Ko‘rinish | Muddati (kun) |
|----------------|-----------|---------------|
| `monthly`      | Oylik     | 31            |
| `quarterly`    | 3 oylik   | 93            |
| `semiannual`   | 6 oylik   | 186           |
| `yearly`       | Yillik    | 366           |

## Talablar

- [Cloudflare](https://dash.cloudflare.com) hisobi
- Workers KV namespace
- Telegram bot ([BotFather](https://t.me/BotFather)) token
- Adminning Telegram `chat_id` (o‘z ID sini botga `/start` yuborib, `@userinfobot` yoki `getUpdates` orqali olish mumkin)

## O‘rnatish

```bash
cd license-worker
npm install
```

1. KV yarating va `wrangler.toml` dagi `id` ni almashtiring:

   ```bash
   npx wrangler kv namespace create esavdo-license-kv
   ```

   Chiqan `id` ni `[[kv_namespaces]]` → `id` ga yozing.

2. Maxfiy o‘zgaruvchilar:

   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_ADMIN_CHAT_ID
   npx wrangler secret put MINIAPP_LOGIN
   npx wrangler secret put MINIAPP_PASSWORD
   npx wrangler secret put WEBHOOK_SECRET
   ```

   - `TELEGRAM_ADMIN_CHAT_ID` — faqat raqam (masalan `123456789`).
   - `MINIAPP_LOGIN` / `MINIAPP_PASSWORD` — Telegram Mini App ichiga kirish (bular **repoga yozilmaydi**, faqat secret).
   - `WEBHOOK_SECRET` — ixtiyoriy; bo‘lsa Telegram `setWebhook` da `secret_token` bilan bir xil qiling (worker so‘rov sarlavhasini tekshiradi).

3. Deploy:

   ```bash
   npx wrangler deploy
   ```

   Chiqadigan worker URL masalan: `https://esavdo-license.<subdomain>.workers.dev`

4. Telegram webhook (o‘z URL va token bilan):

   ```text
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<WORKER_HOST>/webhook/telegram&secret_token=<WEBHOOK_SECRET>
   ```

   `WEBHOOK_SECRET` bo‘lmasa, `secret_token` parametrsiz ham qo‘yish mumkin (kamroq xavfsiz).

5. Tekshiruv: brauzerda `https://<WORKER_HOST>/health`

## Telegram Mini App (admin: foydalanuvchilar, qidiruv, obunani bekor qilish)

- **URL:** `https://<WORKER_HOST>/miniapp` (oxiriga slash qo‘ymang).
- **Kim kiradi:** Telegram **admin** ro‘yxati + **login/parol** (`POST /admin/miniapp-auth`). Keyin 7 kunlik **Bearer** sessiya.
- **Adminlar ro‘yxati:** KV; birinchi marta `TELEGRAM_ADMIN_CHAT_ID` dan to‘ldiriladi.
- **Pastki tugma (ichki chat):** bot bilan shaxsiy chatda `/start` yoki `/menu` yuboring — worker `setChatMenuButton` chaqiradi, pastki **E-Savdo** Web App tugmasi paydo bo‘ladi (chatni yangilang). BotFather da Menu Button ni ham shu URL ga qo‘yishingiz mumkin.
- **Yangi admin:** Mini App ichida «Adminlar» bo‘limidan Telegram user ID qo‘shing. Oxirgi adminni o‘chirib bo‘lmaydi.
- **Admin emas:** botga har qanday matn yuborsa, bot ularning **Telegram user ID** va **chat ID** sini javoban yuboradi (Mini App ular uchun ochilmaydi).
- Mini App: litsenziyalar ro‘yxati, qidiruv, **Obunani bekor qilish** — KV dan `license:{machineId}` o‘chiriladi.

## Electron dastur tomonda

Muhit o‘zgaruvchisi:

- `LICENSE_WORKER_URL` — deploy qilingan worker asosiy URL (oxirida `/` bo‘lmasin).
- `ESAVDO_SKIP_LICENSE=1` — litsenziyani o‘tkazib yuborish (faqat ishlab chiqish).

Windows misol (PowerShell):

```powershell
$env:LICENSE_WORKER_URL="https://esavdo-license.xxx.workers.dev"
$env:ESAVDO_SKIP_LICENSE="0"
npm run electron
```

## API

- `GET /api/verify?machineId=<uuid>` — `{ valid, plan, expiresAt, ... }`
- `POST /api/request` — body: `{ machineId, plan, contact }` — admin ga xabar yuboradi.
- `GET /miniapp` — admin Mini App (HTML).
- `POST /admin/miniapp-auth` — body `{ initData, login, password }` — `{ ok, token }` (Telegram admin + to‘g‘ri parol).
- `POST /admin/logout` — `Authorization: Bearer <token>`.
- `GET /admin/stats` — Bearer — `{ ok, total, active, expired }`.
- `GET /admin/bootstrap` — Bearer — `{ ok, licenses[], admins[], stats }`.
- `GET /admin/licenses` — `tma` — `{ ok, licenses[] }`.
- `GET /admin/admins` — `tma` — `{ ok, admins[] }`.
- `POST /admin/admins/add` — body `{ "telegramUserId": "123" }`.
- `POST /admin/admins/remove` — body `{ "telegramUserId": "123" }` (oxirgi adminni emas).
- `POST /admin/revoke` — body `{ "machineId": "..." }`.

## Sizdan kerak bo‘ladigan ma’lumotlar (checklist)

- [ ] Cloudflare hisobi va KV namespace ID
- [ ] Worker deploy URL
- [ ] `TELEGRAM_BOT_TOKEN`
- [ ] `TELEGRAM_ADMIN_CHAT_ID`
- [ ] (Tavsiya) `WEBHOOK_SECRET` + `setWebhook` da `secret_token`
- [ ] Har bir mijoz kompyuterida Electron: `LICENSE_WORKER_URL` ni qayerdan berish (qisqa yo‘l, installer, yoki `.env` build)
