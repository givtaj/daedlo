import type { Page, BrowserContext, Locator } from "playwright";
export interface Observation<F = Record<string, unknown>> {
  connected: boolean;
  session: string;
  facts: F;
}
export interface Parameter {
  type: "text" | "number" | "boolean" | "select";
  label: string;
  required?: boolean;
  default?: unknown;
  options?: Array<{ value: unknown; label: string }>;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
}
export interface CommandDescriptor {
  id: string;
  label: string;
  params: Record<string, Parameter>;
  changesSession?: boolean;
}
export interface Descriptor {
  id: string;
  version: string;
  label: string;
  states: Array<{
    id: string;
    label: string;
    parent?: string | null;
    support: "supported" | "planned";
  }>;
  commands: CommandDescriptor[];
  recipes: Array<{
    id: string;
    label: string;
    steps: Array<{ command: string; params: Record<string, unknown> }>;
  }>;
}
export interface ExecutionContext {
  boundary(): Promise<void>;
  effect<T>(fn: () => T | Promise<T>): Promise<void>;
  click(locator: Locator): Promise<void>;
  fill(locator: Locator, value: string): Promise<void>;
  select(locator: Locator, value: string): Promise<void>;
  press(locator: Locator, key: string): Promise<void>;
  getSpeed(): "slow" | "normal" | "fast";
}
export type EffectStatus = "saved" | "uncertain" | "rejected" | "not_attempted";
export interface OperationEffect {
  /** Stable public local ID, 1-64 ASCII letters/digits or . _ : -; never a request token or payload hash. */
  id: string;
  /** Static public label, 1-120 characters, without control characters or user data. */
  label: string;
  status: EffectStatus;
}
export interface EffectReport {
  status: EffectStatus;
  /** At most 16 operations. Malformed metadata makes the entire effect report uncertain. */
  operations?: OperationEffect[];
}
export interface BrowserAdapter<F = Record<string, unknown>> {
  model: { id: string; version: string };
  observe(): Promise<Observation<F>>;
  handlers: Record<
    string,
    (
      params: Record<string, any>,
      execution: ExecutionContext,
    ) => Promise<unknown>
  >;
  beginRun?(context: {
    runId: string;
    command: string;
    recipe: boolean;
  }): void | Promise<void>;
  /** Always awaited after an active run, including rejection/stop/failure; only clean owned transient resources, never replay application actions. */
  endRun?(context: {
    runId: string;
    command: string;
    recipe: boolean;
  }): void | Promise<void>;
  settle?(): Promise<unknown>;
  evidence?(
    command: string,
    before: Observation<F>,
    after: Observation<F>,
  ): Promise<Record<string, unknown>>;
  effectStatus?(): EffectReport | Promise<EffectReport>;
  close?(): void | Promise<void>;
}
export interface Result {
  ok: boolean;
  execution: "completed" | "rejected" | "failed" | "stopped";
  runId?: string;
  /** Descriptor command/recipe ID; null for an unknown requested identifier. */
  command: string | null;
  recipe: boolean;
  startedAt: string;
  finishedAt: string;
  cleanupFailed?: true;
  cleanupError?: {
    error_code: "cleanup_incomplete";
    error: string;
  };
  outcome?: {
    kind: "success" | "validation" | "recoverable_error" | "unknown";
    label: string;
  };
  effect: EffectReport;
  error_code?: string;
  error?: string;
}
export interface DriverEvent {
  sequence: number;
  at: string;
  runId: string | null;
  type: string;
  command?: string | null;
  recipe?: boolean;
  outcome?: string;
  execution?: string;
  error_code?: string;
}
export interface ReportResource {
  label: string;
  owned: boolean;
  status: string;
}
export interface DriverReport {
  format: "browser-driver-report/1";
  identity: Record<string, unknown>;
  runId: string | null;
  lastResult: Result | null;
  events: DriverEvent[];
  resources: ReportResource[];
  completedRunIds: string[];
}
export interface CompletedRunReport
  extends Omit<DriverReport, "completedRunIds"> {
  runId: string;
  lastResult: Result;
  eventRange: {
    first: number;
    last: number;
    retainedFirst: number;
    truncated: boolean;
  };
}
export interface Snapshot {
  connected: boolean;
  descriptor: Descriptor;
  state: { id: string } | null;
  revision: string | null;
  commands: Array<{ id: string; enabled: boolean; reason?: string }>;
  recipes: Array<{ id: string; enabled: boolean; reason?: string }>;
  display: Array<{ label: string; value: unknown }>;
  execution: string;
  busy: boolean;
  paused: boolean;
  speed: string;
  runId: string | null;
  progress: { step: number; total: number; lastAction: string | null };
  lastResult: Result | null;
  identity: Record<string, unknown>;
}
export interface DriverSession {
  observe(): Promise<Snapshot>;
  snapshot(): Promise<Snapshot>;
  execute(
    id: string,
    params: Record<string, unknown>,
    revision: string,
  ): Promise<Result>;
  runRecipe(id: string, revision: string): Promise<Result>;
  command(request: {
    id: string;
    params?: Record<string, unknown>;
    revision: string;
    recipe?: boolean;
  }): Promise<Result>;
  pause(): { ok: boolean };
  resume(): { ok: boolean };
  stop(): { ok: boolean };
  setSpeed(value: "slow" | "normal" | "fast"): { ok: boolean };
  report(): DriverReport;
  /** A detached snapshot of one of the latest 16 completed runs; null if absent or expired. */
  report(options: { runId: string }): CompletedRunReport | null;
  close(): Promise<void>;
}
export interface ResourceScope {
  own<T>(
    resource: T,
    options: { label: string; close: (resource: T) => void | Promise<void> },
  ): T;
  attach<T>(
    resource: T,
    options: { label: string; close?: (resource: T) => void | Promise<void> },
  ): T;
  snapshot(): Array<{ label: string; owned: boolean; status: string }>;
  setup<T>(fn: (scope: ResourceScope) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function createDriverSession<F>(options: {
  page: Page;
  context: BrowserContext;
  enginePath: string;
  adapter: BrowserAdapter<F>;
  identity?: Record<string, unknown>;
  resources?: ResourceScope;
}): Promise<DriverSession>;
export function createViewer(options: {
  page: Page;
  context: BrowserContext;
  session: DriverSession;
  port?: number;
}): Promise<{ url: string; close(): Promise<void> }>;
export function createResourceScope(): ResourceScope;
export function createEngineClient(
  path: string,
  options?: { timeoutMs?: number },
): {
  connected(): boolean;
  request(payload: Record<string, unknown>): Promise<Record<string, any>>;
  close(): Promise<void>;
};
export class DriverError extends Error {
  code: string;
  constructor(code: string, message: string);
}
