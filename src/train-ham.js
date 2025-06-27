import { learnHam } from './lib/spamassassin.js';
import { moveTrainedMessages } from './lib/imap-client.js';

await learnHam();
await moveTrainedMessages('inbox');