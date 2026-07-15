import type { PredictedVerdictRecord, ObservedOutcomeRecord } from "./calibration-types.js";
import type { PredictionLedgerEntry } from "./prediction-ledger.js";
import type { LedgerEntry } from "./event-ledger.js";

export function runCalibrationCli(args?: string[], env?: Record<string, string | undefined>): number;

export function toPredictionRecords(rows: PredictionLedgerEntry[]): PredictedVerdictRecord[];

export function toOutcomeRecords(events: LedgerEntry[]): ObservedOutcomeRecord[];
