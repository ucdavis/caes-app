import { deepStrictEqual } from 'node:assert';

import { describe, expect, it } from 'vitest';

import { parseJsonObject, serializeJsonObject, setJsonPath } from '../src/json-edit.js';

describe('json edit utilities', () => {
  it.each(['__proto__', 'constructor', 'prototype'])('edits %s as ordinary own JSON data', (key) => {
    const input = { custom: { keep: true } };
    const prototypes = [Object.prototype, Array.prototype, Function.prototype];
    const descriptors = prototypes.map((prototype) => Object.getOwnPropertyDescriptors(prototype));
    const path = [key, 'caesReviewProbe'];

    expect(() => setJsonPath(input, path, 'created')).toThrow(/is missing/);
    const created = setJsonPath(input, path, 'created', { createMissing: true });
    const updated = setJsonPath(created.value, path, 'updated');
    const unchanged = setJsonPath(updated.value, path, 'updated');
    const leaf = setJsonPath(input, [key], { keep: true });
    const replacedLeaf = setJsonPath(leaf.value, [key], 'replacement');

    expect(created.changed).toBe(true);
    expect(updated.changed).toBe(true);
    expect(created.value[key]).toEqual({ caesReviewProbe: 'created' });
    expect(JSON.parse(serializeJsonObject(updated.value))).toEqual({
      custom: { keep: true },
      [key]: { caesReviewProbe: 'updated' },
    });
    expect(unchanged).toEqual({ value: updated.value, changed: false });
    expect(unchanged.value).toBe(updated.value);
    expect(Object.hasOwn(leaf.value, key)).toBe(true);
    expect(leaf.value[key]).toEqual({ keep: true });
    expect(JSON.parse(serializeJsonObject(replacedLeaf.value))[key]).toBe('replacement');
    expect(Object.getPrototypeOf(created.value)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(created.value[key])).toBe(Object.prototype);
    expect(Object.getPrototypeOf(leaf.value)).toBe(Object.prototype);
    expect(input).toEqual({ custom: { keep: true } });
    deepStrictEqual(prototypes.map((prototype) => Object.getOwnPropertyDescriptors(prototype)), descriptors);
    expect('caesReviewProbe' in {}).toBe(false);
  });

  it('edits prototype-related keys read from JSON without losing other fields', () => {
    const input = parseJsonObject('{"constructor":{"prototype":{"__proto__":{"keep":true}}}}').value;
    const path = ['constructor', 'prototype', '__proto__', 'name'];
    const result = setJsonPath(input, path, 'demo');

    expect(JSON.parse(serializeJsonObject(result.value))).toEqual(JSON.parse(
      '{"constructor":{"prototype":{"__proto__":{"keep":true,"name":"demo"}}}}',
    ));
    expect(serializeJsonObject(input)).not.toContain('demo');
    expect(Object.hasOwn(Object.prototype, 'name')).toBe(false);
  });

  it('preserves array indexing, creation, and no-op behavior', () => {
    const input = { ports: [5165] };
    const appended = setJsonPath(input, ['ports', 1], 5173);
    const updated = setJsonPath(appended.value, ['ports', 0], 5166);
    const created = setJsonPath({}, ['profiles', 0, '__proto__'], 'data', { createMissing: true });

    expect(updated.value).toEqual({ ports: [5166, 5173] });
    expect(input).toEqual({ ports: [5165] });
    expect(setJsonPath(updated.value, ['ports', 0], 5166).changed).toBe(false);
    expect(JSON.parse(serializeJsonObject(created.value))).toEqual({ profiles: [{ ['__proto__']: 'data' }] });
    expect(setJsonPath(updated.value, ['ports', 'length'], 1).value).toEqual({ ports: [5166] });
  });

  it('updates package-like nested values and preserves unknown properties', () => {
    const parsed = parseJsonObject(`{
  "name": "web-app-template",
  "private": true,
  "scripts": {
    "start": "npm-run-all --parallel start:server start:client"
  },
  "custom": {
    "keep": true
  }
}
`);

    const result = setJsonPath(parsed.value, ['scripts', 'start'], 'npm run start:server', {
      createMissing: true,
    });
    const text = serializeJsonObject(result.value, parsed);

    expect(result.changed).toBe(true);
    expect(text).toContain('"custom"');
    expect(text).toContain('"start": "npm run start:server"');
  });

  it('creates missing nested appsettings-like objects', () => {
    const parsed = parseJsonObject(`{
  "Smtp": {
    "FromName": "Web App Template"
  }
}
`);

    const result = setJsonPath(parsed.value, ['Notification', 'BaseUrl'], 'http://localhost:5173', {
      createMissing: true,
    });

    expect(result.changed).toBe(true);
    expect(result.value.Notification).toEqual({
      BaseUrl: 'http://localhost:5173',
    });
  });

  it('replaces launchSettings-like arrays without changing no-op values', () => {
    const parsed = parseJsonObject(`{
  "profiles": {
    "http": {
      "applicationUrl": "http://0.0.0.0:5165"
    }
  },
  "forwardPorts": [
    5165
  ]
}
`);

    const changed = setJsonPath(parsed.value, ['forwardPorts'], [5165, 5173]);
    const unchanged = setJsonPath(changed.value, ['forwardPorts'], [5165, 5173]);

    expect(changed.changed).toBe(true);
    expect(unchanged.changed).toBe(false);
    expect(unchanged.value).toBe(changed.value);
  });

  it('preserves devcontainer-style four-space indentation', () => {
    const parsed = parseJsonObject(`{
    "name": "web-app-template",
    "forwardPorts": [
        5165
    ]
}
`);

    const result = setJsonPath(parsed.value, ['name'], 'demo-app');
    const text = serializeJsonObject(result.value, parsed);

    expect(text).toContain('    "name": "demo-app"');
  });

  it('reports invalid JSON with an actionable file path', () => {
    expect(() => parseJsonObject('{', 'server/appsettings.json')).toThrow(
      /server\/appsettings\.json contains invalid JSON/,
    );
  });
});
