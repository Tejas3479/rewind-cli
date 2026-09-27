import { classifyCapture, CaptureClassification } from './capture_policy.js';
import { CaptureOrigin } from '../events/model.js';

/**
 * Shared Execution Ingestion & Telemetry Service.
 * Unifies capture policy classification, storage persistence, and surfacing decisions
 * across CLI execution (`rewind run`), agent event gateways, and passive shell hooks.
 */
export class CaptureService {
  /**
   * Ingests a canonical execution record into storage and evaluates surfacing.
   * Invariant: Consumes pre-parsed diagnostic structures; does not duplicate diagnostic parsing.
   *
   * @param {import('../events/model.js').CanonicalExecution} execution
   * @param {import('./store.js').StorageEngine} storage
   * @param {object} [options={}]
   * @param {string} [options.captureOrigin='agent_event']
   * @returns {{
   *   classification: 'DISCARD' | 'OBSERVE' | 'PROMOTE',
   *   record: import('./record.js').IncidentRecord | null,
   *   incidentId: string | null,
   *   observationId: string | null,
   *   decision: import('./surfacing.js').SurfacingDecision
   * }}
   */
  static ingestExecution(execution, storage, options = {}) {
    const origin = options.captureOrigin || execution.captureOrigin || CaptureOrigin.AGENT_EVENT;
    const defaultDecision = {
      action: 'SILENCE',
      reason: '',
      matchType: 'NONE',
      bestCandidate: null,
      relevantFailedApproaches: []
    };

    if (!execution || !execution.command || execution.success || execution.exitCode === 0 || execution.outcome === 'SUCCESS') {
      return {
        classification: CaptureClassification.DISCARD,
        record: null,
        incidentId: null,
        observationId: null,
        decision: defaultDecision
      };
    }

    const classification = classifyCapture(execution, storage, origin);

    if (classification === CaptureClassification.DISCARD) {
      return {
        classification: CaptureClassification.DISCARD,
        record: null,
        incidentId: null,
        observationId: null,
        decision: defaultDecision
      };
    }

    if (classification === CaptureClassification.OBSERVE) {
      const obs = storage ? storage.saveObservation(execution) : null;
      return {
        classification: CaptureClassification.OBSERVE,
        record: null,
        incidentId: null,
        observationId: obs?.id || null,
        decision: defaultDecision
      };
    }

    // PROMOTE: Full durable incident in ledger + compute surfacing decision
    let savedRecord = null;
    let decision = defaultDecision;

    if (storage) {
      savedRecord = storage.saveRecord(execution);
      decision = storage.getSurfacingDecision(savedRecord);
    }

    return {
      classification: CaptureClassification.PROMOTE,
      record: savedRecord,
      incidentId: savedRecord ? String(savedRecord.id) : null,
      observationId: null,
      decision: decision || defaultDecision
    };
  }
}
