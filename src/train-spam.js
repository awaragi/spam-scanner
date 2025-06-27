import { learnSpam } from './lib/spamassassin.js';
import { moveTrainedMessages } from './lib/imap-client.js';

await learnSpam();
await moveTrainedMessages('spam');