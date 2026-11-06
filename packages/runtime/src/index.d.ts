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
  /** Available only as a canonical recipe step, never as a direct command. */
  recipeOnly?: boolean;
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
export interface RecipeContext {
  readonly recipe: string;
  readonly step: number;
  readonly session: string;
}
export interface ExecutionContext {
  /** Runtime-created canonical scope for read-only model checks; absent for direct commands or legacy engines. */
  readonly recipeContext?: RecipeContext;
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
export interface FinalizationContext {
  runId: string;
  command: string;
  recipe: boolean;
  /** Runtime always supplies this; optional for legacy direct hook callers. Abort requests cooperation, not proof of completion. */
  signal?: AbortSignal;
}
export interface Finalization {
  runId: string;
  phase: "effect_evidence" | "run_cleanup";
  status: "pending" | "stalled";
  stopRequested: boolean;
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
  endRun?(context: FinalizationContext): void | Promise<void>;
  settle?(): Promise<unknown>;
  evidence?(
    command: string,
    before: Observation<F>,
    after: Observation<F>,
  ): Promise<Record<string, unknown>>;
  effectStatus?(
    context?: FinalizationContext,
  ): EffectReport | Promise<EffectReport>;
  close?(): void | Promise<void>;
}
export interface PresentationStage {
  /** Customer-authored public metadata; captions do not establish success. */
  title: string;
  explanation?: string;
  /** Hold after a verified successful step, 0..3,600,000 ms; default 10,000. Independent of execution speed. */
  holdMs?: number;
  /** Wait for Advance even when the countdown ends. Default false. */
  manual?: boolean;
}
export type Presentation = {
  id: string;
  title: string;
  explanation?: string;
  /** Exactly one stage per canonical command/recipe step. */
  stages: PresentationStage[];
} & (
  | { recipe: string; command?: never; params?: never }
  | { command: string; params?: Record<string, unknown>; recipe?: never }
);
export interface PresentationProgress {
  id: string;
  title: string;
  status: "running" | "completed" | "halted" | "stopped";
  phase: "executing" | "holding" | "finished";
  stage: number;
  total: number;
  /** Pass this token to advancePresentation; valid only for the current hold. */
  stageId: string;
  stageTitle: string;
  explanation: string;
  holdMs: number;
  remainingMs: number;
  manual: boolean;
  reason?: string;
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
  /** Original public failure when Stop takes terminal precedence; no successful outcome is inferred. */
  interruptionError?: { error_code: string; error: string };
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
  presentation?: PresentationProgress;
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
  presentationId?: string;
  stage?: number;
  status?: string;
  phase?: Finalization["phase"];
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
  finalization?: Finalization | null;
}
export interface CompletedRunReport
  extends Omit<DriverReport, "completedRunIds" | "finalization"> {
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
  finalization?: Finalization | null;
  paused: boolean;
  speed: string;
  runId: string | null;
  /** Descriptor-owned flow identity, retained through cleanup; no command parameters. */
  activeRun: { command: string | null; recipe: boolean } | null;
  progress: { step: number; total: number; lastAction: string | null };
  lastResult: Result | null;
  identity: Record<string, unknown>;
  presentations: Array<{
    id: string;
    title: string;
    explanation: string;
    enabled: boolean;
    reason?: string;
  }>;
  presentation: PresentationProgress | null;
}
export interface DriverSession {
  startPresentation(id: string, revision: string): Promise<Result>;
  advancePresentation(stageId: string): {
    ok: boolean;
    error_code?: string;
    error?: string;
  };
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
  /** Default 5000ms total wait; timeout retains active work/cleanup for explicit retry. */
  close(options?: { timeoutMs?: number }): Promise<void>;
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
/** Trusted CLI project. The CLI owns its browser, viewer, returned session and shutdown. */
export type DriverProject = {
  url: string;
  frontend?: FrontendIdentity;
} & (
  | {
      enginePath: string;
      createAdapter(options: {
        page: Page;
        context: BrowserContext;
      }): BrowserAdapter | Promise<BrowserAdapter>;
      createSession?: never;
      identity?: Record<string, unknown>;
      presentations?: Presentation[];
    }
  | {
      /** Own the facade before startup commands; abort stops startup cooperatively. */
      createSession(options: {
        page: Page;
        context: BrowserContext;
        resources: ResourceScope;
        signal: AbortSignal;
        /** Acquire a partial facade once; returning the same object transfers no duplicate ownership. */
        ownSession<T extends { close(): void | Promise<void> }>(session: T): T;
      }): DriverSession | Promise<DriverSession>;
      createAdapter?: never;
    }
);
export type CreateProject = (options: {
  resources: ResourceScope;
}) => DriverProject | Promise<DriverProject>;
export function createDriverSession<F>(options: {
  page: Page;
  context: BrowserContext;
  enginePath: string;
  adapter: BrowserAdapter<F>;
  identity?: Record<string, unknown>;
  resources?: ResourceScope;
  presentations?: Presentation[];
  /** 1..60000ms, default 5000; marks finalization stalled without abandoning its hook. */
  finalizationWaitMs?: number;
}): Promise<DriverSession>;
export interface FrontendIdentity {
  name: string;
  targetOrigin: string | null;
  model: { id: string; version: string };
  /** Local evidence directory; never a credential or public report field. */
  evidenceLocation: string;
  ownership: {
    browser: "owned" | "attached" | "unknown";
    context: "owned" | "attached" | "unknown";
    application: "owned" | "attached" | "unknown";
  };
}
export function createViewer(options: {
  page: Page;
  context: BrowserContext;
  session: DriverSession;
  port?: number;
  frontend?: FrontendIdentity;
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
  /** An unfinished operation still owns dependent resources; retain them until explicit cleanup retry. */
  cleanupPending?: true;
  constructor(code: string, message: string);
}
