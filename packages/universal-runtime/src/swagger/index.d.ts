import type { Page, BrowserContext } from "playwright";
import type { BrowserAdapter, EffectReport } from "../index.js";
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export interface SwaggerRequest {
  path?: Record<string, string | number | boolean>;
  query?: Record<string, string | number | boolean>;
  headers?: Record<string, string | number | boolean>;
  body?: Json;
}
export interface SwaggerOperation {
  key: string;
  operationId: string | null;
  method: string;
  path: string;
  summary: string;
  parameters: Array<Record<string, unknown>>;
  requestBody: Record<string, unknown> | null;
  responses: Record<string, Record<string, unknown>>;
  security: unknown[];
  servers: Array<{ url: string; [key: string]: unknown }>;
  unsupported: string[];
}
export interface SwaggerCatalog {
  version: string;
  operations: SwaggerOperation[];
  document: Record<string, unknown>;
}
export interface SwaggerValidation {
  valid: boolean;
  supported: boolean;
  errors: string[];
}
export interface SwaggerResponseFacts {
  operation: string;
  status: number;
  matched: boolean;
  documented: boolean;
  schemaValid: boolean;
  schemaSupported: boolean;
}
export interface SwaggerFacts {
  docsReady: boolean;
  specMatches: boolean;
  selected: string | null;
  expanded: boolean;
  tryEnabled: boolean;
  prepared: boolean;
  inputValid: boolean;
  targetAllowed: boolean;
  requestCount: number;
  response: SwaggerResponseFacts | null;
}
export function buildCatalog(document: unknown): SwaggerCatalog;
export function getOperation(
  catalog: SwaggerCatalog,
  key: string,
): SwaggerOperation;
export function validateRequest(
  catalog: SwaggerCatalog,
  operation: SwaggerOperation,
  request: unknown,
): SwaggerValidation;
/** baseUrl is the schema retrieval URL, used for relative OpenAPI server URLs. */
export function buildRequest(
  catalog: SwaggerCatalog,
  operation: SwaggerOperation,
  request: SwaggerRequest,
  baseUrl: string,
): {
  url: string;
  method: string;
  headers: Record<string, string | number | boolean>;
  body?: string;
};
export function validateResponse(
  catalog: SwaggerCatalog,
  operation: SwaggerOperation,
  response: { status: number; contentType: string; body?: unknown },
): SwaggerValidation & { documented: boolean };
export function swaggerDigest(document: unknown): string;
export function createSwaggerAdapter(options: {
  page: Page;
  context?: BrowserContext;
  catalog: SwaggerCatalog;
  baseUrl: string;
  docsUrl?: string;
  allowOperations?: string[];
  allowWrites?: string[];
  timeoutMs?: number;
  /** Trusted, private customer evidence. HTTP success alone is not persistence. */
  verifyEffect?: (evidence: {
    operation: SwaggerOperation;
    request: SwaggerRequest;
    response: { status: number; contentType: string; body: unknown };
    matched: boolean;
  }) => EffectReport | Promise<EffectReport>;
}): Promise<BrowserAdapter<SwaggerFacts>>;
