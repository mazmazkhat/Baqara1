# Put Baqarah Together online for free

This takes about 20 minutes and costs nothing. You will use:

* **Turso** (free): keeps the family's data safe.
* **Render** (free): runs the app and gives you a web address to share with the family.

You need a GitHub account with this project in it, because Render copies the app from GitHub.

> **About the free plan:** when nobody has used the app for 15 minutes, Render puts it to sleep. The next person to open it waits up to about a minute while it wakes up, and then it's fast again. Your data is never lost when it sleeps, because it lives in Turso.

---

## Part 1: Create the free database (Turso)

1. Go to **turso.tech** and click **Sign up**. Signing in with GitHub is easiest.
2. Click **Create Database**.
   * **Name:** `baqarah-family`
   * **Location:** choose the one closest to where your family lives. Remember it, because you'll pick the same area on Render.
3. Open the new database. Copy its **URL** (it starts with `libsql://`) into a note.
4. Click **Create Token** (sometimes shown as *Generate Token*). Choose **read & write** and **no expiry**. Copy the long token into the same note.

   ⚠️ Treat the token like a password: don't share it in chats or emails.

## Part 2: Put the app online (Render)

1. Go to **render.com** and **Sign up with GitHub**.
2. Click **New +** → **Blueprint**.
3. Choose the repository **Baqara1** (allow Render to access it if asked), and choose the branch that contains the app.
4. Render reads the `render.yaml` file and shows one service called **baqarah-together**. It will ask for two values:
   * **DATABASE_URL**: paste the `libsql://…` URL from Turso.
   * **DATABASE_AUTH_TOKEN**: paste the token from Turso.
5. Click **Apply** (or **Deploy Blueprint**). The first build takes about 3–5 minutes.
6. When it says **Live**, your address is shown at the top, e.g. `https://baqarah-together.onrender.com`.

   If Render says the name is taken, it adds a few letters. That's fine.

## Part 3: Create your family (once)

1. In Render, open **baqarah-together** → **Environment**. Click the eye icon next to **SETUP_CODE** and copy the code.
2. On your phone, open `https://<your-address>/setup`.
3. Enter the setup code, your family's name, your name, a login name and a **6-digit PIN**. You are now the family administrator.
4. Go to **Settings** → **Family administration** → **Add a family member**. Type their name, tap **Create invite link**, and send the link (WhatsApp, SMS…). Each link works once, for 7 days.
5. Ask everyone to open the app in their phone's browser and choose **Add to Home Screen**, so it opens like a normal app.

## Part 4: Turn on reminders (once, about 2 minutes)

Free hosting sleeps when nobody is using the app, and a sleeping app can't send reminders on time. A free "wake-up" service fixes this. It also means family members no longer wait a minute for the app to open.

1. In the app, go to **Settings** → **Family administration** → **Keep reminders on time**, and tap **Copy** next to the link.
2. Go to **cron-job.org**, create a free account, and tap **Create cronjob**.
3. Paste the link as the **URL**, choose **every 15 minutes**, and **Save**.
4. Back in the app, the same section shows **Last wake-up: …** within 15 minutes.

Keep that link private: it only checks for due reminders, but there is no need to share it.

Reminder settings (time, message, quiet days, evening follow-up, celebration) are chosen by the administrator in **Settings** → **Family administration** → **Reminders & notifications**, and apply to everyone. Members have no reminder settings.

Each family member allows notifications on their own phone once, from the prompt on **Home** (**Turn on notifications** → **Allow**):
* **Android:** open the app in Chrome.
* **iPhone:** first add the app to the Home Screen (Safari → Share ⬆️ → **Add to Home Screen**; iOS 16.4 or newer), then open it from the new icon.

If someone taps **Not now**, the prompt comes back a week later.

Any time, the administrator can tap **Send a kind reminder** on Home. It goes only to members who haven't read yet today, signed with the administrator's name (at most once every 2 hours). It also lists who hasn't turned notifications on, so you can message them directly. The administrator can tap **Send a test** under **This phone**.

## Looking after it

* **Backups:** once a month, go to **Settings** → **Family administration** → **Download family backup**, and keep the file somewhere safe.
* **Forgotten PIN:** in Settings → Family administration, tap **New link (reset PIN)** next to the person and send them the new link.
* **Updates:** when the app's code changes on GitHub, Render updates it automatically.

## If something goes wrong

| What you see | What to do |
|---|---|
| The page takes about a minute to open | Normal after 15 quiet minutes on the free plan. |
| Render shows **Deploy failed** | Open **Logs** in Render and send the last lines to whoever helps you. |
| "Can't reach the server" in the app | Check that the Render service says **Live**. Check that `DATABASE_URL` and `DATABASE_AUTH_TOKEN` are filled in under **Environment**. |
| The setup code is "not correct" | Copy it again from Render → Environment → SETUP_CODE, with no spaces. |
| `/setup` sends you to the sign-in page | The family has already been created. Sign in instead. |

Free-plan limits can change, so check render.com/docs/free and turso.tech/pricing if something stops working.
