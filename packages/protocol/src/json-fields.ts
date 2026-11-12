import { hex } from '@scure/base';
import { badMessage } from './errors';

export type JsonObject = Record<string, unknown>;

export type StringRule = { maxChars: number; pattern?: RegExp; printable?: boolean };

const CONTROL_CHARACTERS = /\p{Cc}/u;

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decodeURIComponent(hex.encode(bytes).replace(/../g, '%$&')).replace(/^\uFEFF/u, ''));
  } catch (error) {
    throw badMessage('message is not valid UTF-8 JSON', error);
  }
}

export function parseJsonObject(bytes: Uint8Array): JsonObject {
  const value = parseJson(bytes);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw badMessage('message must be a JSON object');
  }
  return value as JsonObject;
}

export function assertOnlyKeys(object: JsonObject, allowed: readonly string[]): void {
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw badMessage('message has unknown fields');
  }
}

function stringProblem(value: unknown, rule: StringRule): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'must be a non-empty string';
  }
  if ([...value].length > rule.maxChars) {
    return `is longer than ${rule.maxChars} characters`;
  }
  if (rule.pattern !== undefined && !rule.pattern.test(value)) {
    return 'has an invalid format';
  }
  if (rule.printable === true && CONTROL_CHARACTERS.test(value)) {
    return 'contains control characters';
  }
  return null;
}

export function matchesRule(value: unknown, rule: StringRule): value is string {
  return stringProblem(value, rule) === null;
}

export function readString(object: JsonObject, key: string, rule: StringRule): string {
  const value = object[key];
  const problem = stringProblem(value, rule);
  if (problem !== null) {
    throw badMessage(`${key} ${problem}`);
  }
  return value as string;
}

export function readNullableString(object: JsonObject, key: string, rule: StringRule): string | null {
  if (object[key] === null) {
    return null;
  }
  return readString(object, key, rule);
}

export function readObject(object: JsonObject, key: string): JsonObject {
  const value = object[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw badMessage(`${key} must be an object`);
  }
  return value as JsonObject;
}

export function readText(object: JsonObject, key: string, maxChars: number): string {
  const value = object[key];
  if (typeof value !== 'string') {
    throw badMessage(`${key} must be a string`);
  }
  if ([...value].length > maxChars) {
    throw badMessage(`${key} is longer than ${maxChars} characters`);
  }
  return value;
}

function isChoice<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && (choices as readonly string[]).includes(value);
}

export function readChoice<T extends string>(object: JsonObject, key: string, choices: readonly T[]): T {
  const value = object[key];
  if (!isChoice(value, choices)) {
    throw badMessage(`${key} has an unsupported value`);
  }
  return value;
}

export function readBoolean(object: JsonObject, key: string): boolean {
  const value = object[key];
  if (typeof value !== 'boolean') {
    throw badMessage(`${key} must be a boolean`);
  }
  return value;
}

export function readIndex(object: JsonObject, key: string): number {
  const value = object[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw badMessage(`${key} must be a non-negative integer`);
  }
  return value;
}

type ListRule = { minItems: number; maxItems: number };

export function readChoiceList<T extends string>(object: JsonObject, key: string, choices: readonly T[], rule: ListRule): T[] {
  const value = object[key];
  if (!Array.isArray(value)) {
    throw badMessage(`${key} must be an array`);
  }
  if (value.length < rule.minItems || value.length > rule.maxItems) {
    throw badMessage(`${key} must have between ${rule.minItems} and ${rule.maxItems} items`);
  }
  if (new Set(value).size !== value.length) {
    throw badMessage(`${key} must not contain duplicates`);
  }
  if (!value.every((item): item is T => isChoice(item, choices))) {
    throw badMessage(`${key} has an unsupported value`);
  }
  return [...value];
}

export function readNullableChoice<T extends string>(object: JsonObject, key: string, choices: readonly T[]): T | null {
  if (object[key] === null) {
    return null;
  }
  return readChoice(object, key, choices);
}
