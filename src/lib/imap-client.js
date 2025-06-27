import Imap from 'imap';
import {getConfig} from './util.js';
import pino from 'pino';

const config = getConfig();
const logger = pino();

export function connect() {
  return new Imap({
    user: config.IMAP_USER,
    password: config.IMAP_PASSWORD,
    host: config.IMAP_HOST,
    port: config.IMAP_PORT,
    tls: config.IMAP_TLS === true,
  });
}

export async function createAppFolders(folders) {
  const imap = connect();
  
  return new Promise((resolve, reject) => {
    imap.once('ready', () => {
      let pending = folders.length;
      
      if (pending === 0) {
        imap.end();
        return resolve();
      }

      folders.forEach(folder => {
        const parts = folder.split(/[/.]/);
        const separator = folder.match(/[/.]/) ? folder.match(/[/.]/)[0] : '.';
        let currentPath = '';

        // Create folders sequentially to avoid race conditions
        const createNextPart = (index) => {
          if (index >= parts.length) {
            if (--pending === 0) {
              imap.end();
              resolve();
            }
            return;
          }

          const part = parts[index];
          currentPath = currentPath ? `${currentPath}${separator}${part}` : part;
          logger.info({folder: currentPath}, `Creating folder ${currentPath}`);

          imap.addBox(currentPath, err => {
            if (err && err.message && err.message.includes('exists')) {
              logger.info({folder: currentPath}, 'Folder exists');
            } else if (err) {
              logger.error({folder: currentPath, error: err.message}, 'Failed to create folder');
              // Continue with next part even if this one failed
            } else {
              logger.info({folder: currentPath}, 'Created folder');
            }

            // Create next part in sequence
            createNextPart(index + 1);
          });
        };

        // Start creating folders for this path
        createNextPart(0);
      });
    });

    imap.once('error', (err) => {
      logger.error({error: err.message}, 'IMAP connection error');
      reject(err);
    });

    imap.connect();
  });
}
export async function findFirstUIDOnDate(folder, dateString) {
  const imap = connect();
  return new Promise((resolve, reject) => {
    imap.once('ready', () => {
      imap.openBox(folder, true, err => {
        if (err) return reject(err);
        const criteria = dateString ? [['SINCE', new Date(dateString)]] : ['ALL'];
        logger.debug({folder, criteria}, 'Searching messages');
        imap.search(criteria, (err, results) => {
          if (err || !results.length) {
            logger.debug({folder}, 'No messages found');
            imap.end();
            return resolve(null);
          }
          const f = imap.fetch(results, { bodies: '', struct: true });
          f.on('message', msg => {
            msg.once('attributes', attrs => {
              const uid = attrs.uid;
              const date = attrs.date;
              imap.end();
              resolve({ uid, internaldate: date.toISOString() });
            });
          });
        });
      });
    });
    imap.once('error', reject);
    imap.connect();
  });
}