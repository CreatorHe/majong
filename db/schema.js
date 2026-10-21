import { sqliteTable, text, integer, primaryKey, uniqueIndex, index, check, foreignKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const analyticsClients = sqliteTable('analytics_clients', {
  clientId: text('client_id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  scope: text('scope').notNull(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  quotaWindow: integer('quota_window').notNull().default(0),
  quotaCount: integer('quota_count').notNull().default(0),
}, table => [check('analytics_clients_scope', sql`${table.scope} IN ('production', 'sandbox')`)]);

export const rawEvents = sqliteTable('raw_events', {
  scope: text('scope').notNull(),
  clientId: text('client_id').notNull().references(() => analyticsClients.clientId),
  eventId: text('event_id').notNull(),
  eventName: text('event_name').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  eventHash: text('event_hash').notNull(),
  occurredAt: text('occurred_at').notNull(),
  receivedAt: text('received_at').notNull(),
  sessionId: text('session_id').notNull(),
  appRelease: text('app_release').notNull(),
  rulesVersion: text('rules_version').notNull(),
  scoreModelVersion: text('score_model_version').notNull(),
  mode: text('mode'),
  runId: text('run_id'),
  roundAttemptId: text('round_attempt_id'),
  handId: text('hand_id'),
  payloadJson: text('payload_json').notNull(),
}, table => [
  primaryKey({ columns: [table.scope, table.clientId, table.eventId] }),
  index('raw_events_received').on(table.receivedAt),
]);

export const completedHands = sqliteTable('completed_hands', {
  scope: text('scope').notNull(),
  clientId: text('client_id').notNull().references(() => analyticsClients.clientId),
  handId: text('hand_id').notNull(),
  eventId: text('event_id').notNull(),
  factHash: text('fact_hash').notNull(),
  runId: text('run_id').notNull(),
  roundAttemptId: text('round_attempt_id').notNull(),
  mode: text('mode').notNull(),
  rulesVersion: text('rules_version').notNull(),
  scoreModelVersion: text('score_model_version').notNull(),
  shape: text('shape').notNull(),
  roundNo: integer('round_no').notNull(),
  roundScore: integer('round_score').notNull(),
  targetScore: integer('target_score').notNull(),
  passed: integer('passed').notNull(),
  recordQuality: text('record_quality').notNull(),
  occurredAt: text('occurred_at').notNull(),
  receivedAt: text('received_at').notNull(),
}, table => [
  primaryKey({ columns: [table.scope, table.clientId, table.handId] }),
  uniqueIndex('completed_hands_round').on(table.scope, table.clientId, table.roundAttemptId, table.rulesVersion, table.scoreModelVersion),
  index('completed_hands_report').on(table.scope, table.mode, table.rulesVersion, table.scoreModelVersion, table.recordQuality),
  check('completed_hands_scores', sql`${table.roundScore} >= 0 AND ${table.targetScore} > 0`),
]);

export const handPatterns = sqliteTable('hand_patterns', {
  scope: text('scope').notNull(),
  clientId: text('client_id').notNull(),
  handId: text('hand_id').notNull(),
  patternId: text('pattern_id').notNull(),
}, table => [
  primaryKey({ columns: [table.scope, table.clientId, table.handId, table.patternId] }),
  foreignKey({ columns: [table.scope, table.clientId, table.handId], foreignColumns: [completedHands.scope, completedHands.clientId, completedHands.handId] }).onDelete('cascade'),
  index('hand_patterns_pattern').on(table.patternId),
]);

// v2 terminal facts are shared by round_settled and hand_completed. Keeping
// them separate from legacy hands preserves negative net/cumulative scores.
export const roundSettlements = sqliteTable('round_settlements', {
  scope: text('scope').notNull(),
  clientId: text('client_id').notNull().references(() => analyticsClients.clientId),
  settlementId: text('settlement_id').notNull(),
  eventId: text('event_id').notNull(),
  factHash: text('fact_hash').notNull(),
  runId: text('run_id').notNull(),
  roundAttemptId: text('round_attempt_id').notNull(),
  mode: text('mode').notNull(),
  rulesVersion: text('rules_version').notNull(),
  scoreModelVersion: text('score_model_version').notNull(),
  roundNo: integer('round_no').notNull(),
  legal: integer('legal').notNull(),
  passed: integer('passed').notNull(),
  resultType: text('result_type').notNull(),
  shape: text('shape'),
  processScore: integer('process_score').notNull(),
  winScore: integer('win_score').notNull(),
  penaltyScore: integer('penalty_score').notNull(),
  roundScore: integer('round_score').notNull(),
  roundStartScore: integer('round_start_score').notNull(),
  cumulativeBefore: integer('cumulative_before').notNull(),
  cumulativeAfter: integer('cumulative_after').notNull(),
  targetScore: integer('target_score').notNull(),
  recordQuality: text('record_quality').notNull(),
  payloadJson: text('payload_json').notNull(),
  occurredAt: text('occurred_at').notNull(),
  receivedAt: text('received_at').notNull(),
}, table => [
  primaryKey({ columns: [table.scope, table.clientId, table.settlementId] }),
  uniqueIndex('round_settlements_round').on(table.scope, table.clientId, table.roundAttemptId, table.rulesVersion, table.scoreModelVersion),
  index('round_settlements_report').on(table.scope, table.mode, table.rulesVersion, table.scoreModelVersion, table.recordQuality),
  check('round_settlements_positive_parts', sql`${table.processScore} >= 0 AND ${table.winScore} >= 0 AND ${table.penaltyScore} >= 0 AND ${table.targetScore} > 0`),
]);

export const settlementPatterns = sqliteTable('settlement_patterns', {
  scope: text('scope').notNull(),
  clientId: text('client_id').notNull(),
  settlementId: text('settlement_id').notNull(),
  patternId: text('pattern_id').notNull(),
  kind: text('kind').notNull(),
}, table => [
  primaryKey({ columns: [table.scope, table.clientId, table.settlementId, table.patternId] }),
  foreignKey({ columns: [table.scope, table.clientId, table.settlementId], foreignColumns: [roundSettlements.scope, roundSettlements.clientId, roundSettlements.settlementId] }).onDelete('cascade'),
]);
