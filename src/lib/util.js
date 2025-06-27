export function getConfig() {
  return {
    IMAP_HOST: process.env.IMAP_HOST,
    IMAP_PORT: parseInt(process.env.IMAP_PORT || '993', 10),
    IMAP_USER: process.env.IMAP_USER,
    IMAP_PASSWORD: process.env.IMAP_PASSWORD,
    IMAP_TLS: process.env.IMAP_TLS === 'true',
    FOLDER_INBOX: process.env.FOLDER_INBOX || 'INBOX',
    FOLDER_SPAM: process.env.FOLDER_SPAM || 'INBOX.spam',
    FOLDER_TRAIN_SPAM: process.env.FOLDER_TRAIN_SPAM || 'INBOX.scanner.train-spam',
    FOLDER_TRAIN_HAM: process.env.FOLDER_TRAIN_HAM || 'INBOX.scanner.train-ham',
    FOLDER_STATE: process.env.FOLDER_STATE || 'scanner.state',
    STATE_KEY_SCANNER: process.env.STATE_KEY_SCANNER || 'scanner',
    SCAN_BATCH_SIZE: parseInt(process.env.SCAN_BATCH_SIZE || '200', 10)
  };
}