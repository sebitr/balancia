import path from 'path';
import { warn } from '../plugin/utils.js';

function normalizePathToPosix(filePath) {
  // `path.relative` uses OS-specific separators. For stable `.po` references we
  // always use POSIX separators, regardless of the OS that ran extraction.
  return path.posix.normalize(filePath.split(path.win32.sep).join(path.posix.sep));
}
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function isForbiddenObjectKey(key) {
  return FORBIDDEN_OBJECT_KEYS.has(key);
}
function hasLocalesToExtract(config) {
  const {
    locales
  } = config.extract;
  return locales === 'infer' || locales.length > 0;
}

// Essentialls lodash/set, but we avoid this dependency
function setNestedProperty(obj, keyPath, value) {
  const keys = keyPath.split('.');
  for (const key of keys) {
    if (isForbiddenObjectKey(key)) {
      throw new Error(`Invalid message id segment: ${key}`);
    }
  }
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!Object.prototype.hasOwnProperty.call(current, key) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = Object.create(null);
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}
function getSortedMessages(messages) {
  const warnedMissingReferenceIds = new Set();
  return messages.toSorted((messageA, messageB) => {
    const refA = messageA.references[0];
    const refB = messageB.references[0];

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (refA == null) {
      warnAboutMissingReference(messageA.id, warnedMissingReferenceIds);
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (refB == null) {
      warnAboutMissingReference(messageB.id, warnedMissingReferenceIds);
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (refA == null || refB == null) {
      return 0;
    }

    // Sort by path, then line. Same path+line: preserve original order
    return compareReferences(refA, refB);
  });
}
function warnAboutMissingReference(id, warnedMissingReferenceIds) {
  if (warnedMissingReferenceIds.has(id)) return;
  warnedMissingReferenceIds.add(id);
  warn(`Missing file reference for extracted message: ${id}`);
}
function localeCompare(a, b) {
  return a.localeCompare(b, 'en');
}
function compareReferences(refA, refB) {
  const pathCompare = localeCompare(refA.path, refB.path);
  if (pathCompare !== 0) return pathCompare;
  return (refA.line ?? 0) - (refB.line ?? 0);
}
function getDefaultProjectRoot() {
  return process.cwd();
}

export { compareReferences, getDefaultProjectRoot, getSortedMessages, hasLocalesToExtract, isForbiddenObjectKey, localeCompare, normalizePathToPosix, setNestedProperty };
