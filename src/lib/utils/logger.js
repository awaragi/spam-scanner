import pino from 'pino';

// Read environment variables
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_FORMAT = process.env.LOG_FORMAT || 'json';

// Validate log level
const VALID_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const logLevel = VALID_LOG_LEVELS.includes(LOG_LEVEL.toLowerCase()) 
  ? LOG_LEVEL.toLowerCase() 
  : 'info';

if (LOG_LEVEL && !VALID_LOG_LEVELS.includes(LOG_LEVEL.toLowerCase())) {
  console.warn(`Invalid LOG_LEVEL "${LOG_LEVEL}", defaulting to "info"`);
}

// Validate log format
const VALID_LOG_FORMATS = ['json', 'jsonl', 'pretty'];
const logFormat = VALID_LOG_FORMATS.includes(LOG_FORMAT.toLowerCase()) 
  ? LOG_FORMAT.toLowerCase() 
  : 'json';

if (LOG_FORMAT && !VALID_LOG_FORMATS.includes(LOG_FORMAT.toLowerCase())) {
  console.warn(`Invalid LOG_FORMAT "${LOG_FORMAT}", defaulting to "json"`);
}

// Configure Pino options
const options = {
  level: logLevel,
  formatters: {
    level: (label) => ({ level: label })
  },
  timestamp: pino.stdTimeFunctions.isoTime
};

// Add pino-pretty transport if pretty format requested
if (logFormat === 'pretty') {
  try {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    };
  } catch (err) {
    console.error('Failed to load pino-pretty. Install with: npm install --save-dev pino-pretty');
    console.error('Falling back to JSON format');
  }
}

// Create root logger instance
const pinoLogger = pino(options);

/**
 * Adds forComponent method to a logger instance
 * @param {Object} logger - Pino logger instance
 * @returns {Object} - Logger with forComponent method
 */
function attachForComponent(logger) {
  /**
   * Creates a component-scoped child logger
   * @param {string} component - Component name (e.g., 'rspamd', 'imap', 'config')
   * @returns {Object} - Child logger with component context and forMessage method
   */
  logger.forComponent = function(component) {
    const componentLogger = this.child({ component });
    
    /**
     * Creates a message-scoped child logger with UID correlation
     * @param {number} uid - Email UID for correlation
     * @returns {Object} - Child logger with both component and uid context
     */
    componentLogger.forMessage = function(uid) {
      return this.child({ uid });
    };
    
    return componentLogger;
  };
  
  return logger;
}

// Attach forComponent method to root logger
const rootLogger = attachForComponent(pinoLogger);

export { rootLogger };
