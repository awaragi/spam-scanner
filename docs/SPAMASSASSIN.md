# SpamAssassin Setup Guide with KAM.cf and debian-spamd

This guide explains how to install and configure `spamd`, `spamc`, and `sa-learn` with a dedicated `debian-spamd` user, and how to securely add the KAM.cf ruleset for improved spam detection.

---

## 📦 1. Install SpamAssassin

```bash
sudo apt update
sudo apt install spamassassin
```

---

## 👤 2. Enable and Configure the `debian-spamd` User

SpamAssassin creates a system user named `debian-spamd` by default. You can inspect it with:

```bash
getent passwd debian-spamd
```

Ensure the home directory exists and has correct permissions:

```bash
sudo mkdir -p /var/lib/spamassassin/.spamassassin
sudo chown -R debian-spamd:debian-spamd /var/lib/spamassassin
```

---

## ⚙️ 3. Configure `spamd` as a Systemd Service

Check if `spamd` is already enabled:

```bash
systemctl status spamd
```

If not, create or edit the default options:

```bash
sudo nano /etc/default/spamd
```

Set:

```text
OPTIONS="--create-prefs --max-children 5 --helper-home-dir=/var/lib/spamassassin"
```

Then enable and restart:

```bash
sudo systemctl enable spamd
sudo systemctl restart spamd
```

---

## 🧪 4. Test `spamc` and Bayes Functionality

Train Bayes filters (optional):

```bash
sudo -u debian-spamd sa-learn --spam /path/to/spam
sudo -u debian-spamd sa-learn --ham  /path/to/ham
```

Scan test message:

```bash
spamc -u debian-spamd < message.eml
```

---

## 🛡 5. Add KAM.cf Rule Channel (Official & GPG Verified)

### 5.1 Import KAM GPG Key

```bash
wget https://mcgrail.com/downloads/kam.sa-channels.mcgrail.com.key
sudo sa-update --import kam.sa-channels.mcgrail.com.key
```

### 5.2 Update via Channel

```bash
sudo sa-update --gpgkey 24C063D8 --channel kam.sa-channels.mcgrail.com
```

### 5.3 Compile Rules

```bash
sudo sa-compile
```

### 5.4 Restart `spamd`

```bash
sudo systemctl restart spamd
```

---

## 🔁 6. Set Up Cron Job for Daily Rule Updates

Edit crontab:

```bash
sudo nano /etc/crontab
```

Add:

```cron
30 2 * * * root /usr/bin/sa-update --gpgkey 24C063D8 --channel kam.sa-channels.mcgrail.com && /usr/bin/sa-compile && /bin/systemctl restart spamd >> /var/log/sa-update.log 2>&1
```

Create the log file if needed:

```bash
sudo touch /var/log/sa-update.log
sudo chmod 644 /var/log/sa-update.log
```

---

## ✅ 7. Verify Installation

Check loaded rules:

```bash
spamassassin --lint -D 2>&1 | grep -i kam
```

Confirm Bayes DB:

```bash
sudo -u debian-spamd sa-learn --dump magic
```

---

## 🧾 Notes

- `spamc` must use `-u debian-spamd` to ensure correct preferences are loaded.
- `sa-update` and `sa-compile` must run as **root** to update global rule directories.
- `debian-spamd` user owns Bayes DB and user_prefs under `/var/lib/spamassassin/.spamassassin/`.

---