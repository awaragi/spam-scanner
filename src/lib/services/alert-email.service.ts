import { randomUUID } from 'crypto';

// Distinct from both FOLDER_INBOX's owner domain and "localhost" - rspamd penalizes
// a Message-ID host that matches the From/To domain (MID_RHS_MATCH_*) as well as one
// that isn't a dotted hostname at all (MID_RHS_NOT_FQDN); an unrelated dotted host
// avoids both.
const ALERT_MESSAGE_ID_DOMAIN = 'spam-scanner.internal';

/**
 * Builds a plain-text RFC822 message alerting the mailbox owner that AI
 * classification has been failing repeatedly for the same reason. Includes a
 * Message-ID (rspamd's MISSING_MID otherwise scores this a few points toward
 * "low spam", since a locally-appended message has no originating MTA to add one).
 * @param {{reason: string, count: number, lastError: string, lastAt: string}} alert
 * @param {string} imapUser
 * @param {{now?: () => Date, messageId?: () => string}} [opts]
 * @returns {string}
 */
export function buildAiFailureAlertEmail(
  alert,
  imapUser,
  { now = () => new Date(), messageId = () => randomUUID() } = {}
) {
  const { reason, count, lastError, lastAt } = alert;
  return `From: Spam Scanner <scanner@localhost>
To: ${imapUser}
Subject: Spam Scanner: AI classification failing repeatedly (${reason})
Message-ID: <${messageId()}@${ALERT_MESSAGE_ID_DOMAIN}>
Date: ${now().toUTCString()}
Content-Type: text/plain; charset=utf-8
MIME-Version: 1.0

The AI classification safety net has failed ${count} times in a row with the same reason.

Reason: ${reason}
Consecutive failures: ${count}
Last error: ${lastError}
Last failure at: ${lastAt}

This is a one-time notice for this ongoing issue - it will not repeat until AI
classification succeeds again. Check AI_BASE_URL/AI_API_KEY/AI_MODEL and the
provider's status if this is unexpected.`;
}
