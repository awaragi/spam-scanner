import { config } from './config.ts';
import { AiFailureTracker } from '../services/ai-failure-tracker.service.ts';

// Built once, lazily, on first use - every call to createDefaultContext()
// after that returns this exact same object, never a fresh one.
let defaultContext = null;

/**
 * Returns the shared, production-shaped context: the real config singleton
 * and one AiFailureTracker instance. Memoized rather than built fresh per
 * call - if it weren't, a controller that forgot to forward its own `ctx`
 * into an activity it calls would silently hand that activity a brand-new,
 * empty AiFailureTracker instead of an error, and the alert threshold would
 * just quietly never fire. Memoizing means the default is always correct
 * even when someone forgets to pass ctx along explicitly. Tests never rely
 * on this - they always build their own ctx (see fixtureContext), so this
 * shared instance never leaks into test isolation.
 */
export function createDefaultContext() {
  if (!defaultContext) {
    defaultContext = { config, aiFailureTracker: new AiFailureTracker() };
  }
  return defaultContext;
}
