import {newClient} from "../lib/clients/imap-client.js";
import {writeScannerState} from "../lib/state-manager.js";

const now = new Date();

const imap = newClient();

try {
    await imap.connect();
    await writeScannerState(imap, {
        last_uid: 0,
        last_seen_date: now.toISOString(),
        last_checked: now.toISOString()
    });
} finally {
    await imap.logout();
}

