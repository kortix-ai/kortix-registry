---
name: email
description: "Send and receive email via IMAP/SMTP using curl. Works with any email provider. By default uses the agent's own inbox configured via KORTIX_AGENT_EMAIL_INBOX_* env vars, but can target any SMTP/IMAP server by passing credentials directly. Use when the agent needs to: send email, check inbox, read messages, reply, search, or manage flags."
---

# Email (IMAP/SMTP via curl)

Send and receive email from the terminal. Just `curl`. Works with any provider — AgentMail, Gmail, Outlook, Fastmail, self-hosted, anything with IMAP/SMTP.

By default uses the agent's own inbox (env vars below). Can also target any arbitrary SMTP/IMAP server by swapping the credentials.

---

## Default Credentials (agent's inbox)

These env vars are pre-configured:

```bash
USER="$KORTIX_AGENT_EMAIL_INBOX_USER_NAME"
PASS="$KORTIX_AGENT_EMAIL_INBOX_PASSWORD"
SMTP="smtps://$KORTIX_AGENT_EMAIL_INBOX_SMTP_HOST:$KORTIX_AGENT_EMAIL_INBOX_SMTP_PORT"
IMAP="imaps://$KORTIX_AGENT_EMAIL_INBOX_IMAP_HOST:$KORTIX_AGENT_EMAIL_INBOX_IMAP_PORT"
FROM="$KORTIX_AGENT_EMAIL_INBOX_FROM_NAME <$KORTIX_AGENT_EMAIL_INBOX_FROM_EMAIL>"
EMAIL="$KORTIX_AGENT_EMAIL_INBOX_FROM_EMAIL"
```

To use a different mailbox, just swap those values.

**Never print credentials.**

---

## Send

```bash
TMPFILE=$(mktemp)
cat > "$TMPFILE" <<EOF
From: $FROM
To: recipient@example.com
Subject: Hello
Date: $(date -R)
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8

Your message body here.
EOF

curl -sS "$SMTP" --user "$USER:$PASS" \
  --mail-from "$EMAIL" \
  --mail-rcpt "recipient@example.com" \
  --upload-file "$TMPFILE"

rm -f "$TMPFILE"
```

Multiple recipients: add more `--mail-rcpt` flags. CC: add `Cc:` header in the file AND a `--mail-rcpt` per CC address.

---

## List Folders

```bash
curl -sS "$IMAP/" --user "$USER:$PASS" | tr -d '\r'
```

---

## Inbox Count

```bash
curl -sS "$IMAP/INBOX" --user "$USER:$PASS" -X "EXAMINE INBOX" | tr -d '\r'
```

`* N EXISTS` = total messages.

---

## List Messages

```bash
curl -sS "$IMAP/INBOX" --user "$USER:$PASS" \
  -X "FETCH 1:* (FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])" | tr -d '\r'
```

---

## Read a Message

```bash
curl -sS "$IMAP/INBOX" --user "$USER:$PASS" \
  -X "FETCH 3 BODY.PEEK[]" | tr -d '\r'
```

`BODY.PEEK[]` = read without marking seen. `BODY[]` = mark as read.

---

## Search

```bash
curl -sS "$IMAP/INBOX" --user "$USER:$PASS" -X "SEARCH UNSEEN" | tr -d '\r'
curl -sS "$IMAP/INBOX" --user "$USER:$PASS" -X 'SEARCH FROM "bob@example.com"' | tr -d '\r'
curl -sS "$IMAP/INBOX" --user "$USER:$PASS" -X 'SEARCH SUBJECT "meeting"' | tr -d '\r'
curl -sS "$IMAP/INBOX" --user "$USER:$PASS" -X 'SEARCH SINCE 01-Jan-2026' | tr -d '\r'
curl -sS "$IMAP/INBOX" --user "$USER:$PASS" -X 'SEARCH UNSEEN FROM "bob"' | tr -d '\r'
```

Returns `* SEARCH 1 4 7` — matching sequence numbers.

---

## Mark Read / Unread

```bash
curl -sS "$IMAP/INBOX" --user "$USER:$PASS" -X 'STORE 3 +FLAGS (\Seen)' | tr -d '\r'
curl -sS "$IMAP/INBOX" --user "$USER:$PASS" -X 'STORE 3 -FLAGS (\Seen)' | tr -d '\r'
```

---

## Delete

```bash
curl -sS "$IMAP/INBOX" --user "$USER:$PASS" -X 'STORE 3 +FLAGS (\Deleted)' | tr -d '\r'
curl -sS "$IMAP/INBOX" --user "$USER:$PASS" -X 'EXPUNGE' | tr -d '\r'
```

---

## Reply

1. FETCH original to get `From`, `Subject`, `Message-ID`
2. Compose reply with `In-Reply-To:` and `References:` set to original `Message-ID`
3. Prefix subject with `Re: `
4. Send via SMTP as above

---

## Rules

- **Act, don't ask.** Send/read when instructed.
- **Never print credentials.**
- **Human language.** Say "I sent the email" not "curl smtps://..."
- **Always `tr -d '\r'`** on IMAP output.
- **Identity:** when sending from the agent's own inbox, always use the configured FROM_NAME/FROM_EMAIL.
