import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { customizeFile } from '../src/init-patches.js';
import type { ResolvedInitInputs } from '../src/init-types.js';

const file = '.devcontainer/devcontainer.json';
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/template.json', import.meta.url), 'utf8'));
const source = Buffer.from(fixtures[file]);
const config: ResolvedInitInputs = {
  appId: 'demo-app', displayName: 'Demo App', ports: { server: 6165, client: 6173, database: 15333 },
};
const templatePorts = { server: 5165, client: 5173, database: 14333 };
const encode = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const template = () => JSON.parse(source.toString());
const configured = (inputs = config) => JSON.parse(customizeFile(file, source, source, inputs).content.toString());

describe('devcontainer port attribute migration', () => {
  it.each(['template', 'configured', 'unchanged ports'] as const)(
    'preserves unmanaged additions, modifications, and deletions in %s entries', (state) => {
      const inputs = state === 'unchanged ports' ? { ...config, ports: templatePorts } : config;
      const current = state === 'template' ? template() : configured(inputs);
      const ports = state === 'template' ? templatePorts : inputs.ports;
      current.portsAttributes[ports.server].protocol = 'https';
      current.portsAttributes[ports.client].onAutoForward = 'silent';
      delete current.portsAttributes[ports.database].onAutoForward;
      current.portsAttributes['9000'] = { label: 'Developer service', protocol: 'http' };
      const patched = customizeFile(file, source, encode(current), inputs);
      const result = JSON.parse(patched.content.toString());
      expect(result.portsAttributes).toEqual({
        [inputs.ports.server]: { label: 'Web App (ASP.NET + Vite Proxy)', onAutoForward: 'ignore', protocol: 'https' },
        [inputs.ports.client]: { label: `Vite Dev Server (Internal - Use ${inputs.ports.server})`, onAutoForward: 'silent' },
        [inputs.ports.database]: { label: 'SQL Server (Internal)' },
        '9000': current.portsAttributes['9000'],
      });
      const rerun = customizeFile(file, source, patched.content, inputs);
      expect(rerun.content).toBe(patched.content);
      expect(rerun.changes).toEqual({});
      if (state !== 'template') expect(patched.changes).toEqual({});
    },
  );

  it.each(['template', 'configured', 'unchanged ports'] as const)('rejects conflicting managed labels in %s entries', (state) => {
    const inputs = state === 'unchanged ports' ? { ...config, ports: templatePorts } : config;
    const current = state === 'template' ? template() : configured(inputs);
    const key = state === 'template' ? templatePorts.client : inputs.ports.client;
    current.portsAttributes[key].label = 'Manual label';
    expect(() => customizeFile(file, source, encode(current), inputs)).toThrow(/managed configuration/);
  });

  it('records and serializes a key-only move with all other settings already configured', () => {
    const current = configured();
    current.portsAttributes['14333'] = current.portsAttributes['15333'];
    delete current.portsAttributes['15333'];
    current.portsAttributes['14333'].protocol = 'https';
    const patched = customizeFile(file, source, encode(current), config);
    const result = JSON.parse(patched.content.toString());
    expect(result.portsAttributes['14333']).toBeUndefined();
    expect(result.portsAttributes['15333']).toEqual(current.portsAttributes['14333']);
    expect(Object.keys(patched.changes)).toEqual(['portsAttributes']);
  });

  it('preserves unmanaged edits on template entries not included in the port mapping', () => {
    const original = template();
    original.portsAttributes['9000'] = { label: 'Additional template service', onAutoForward: 'ignore' };
    const current = structuredClone(original);
    current.portsAttributes['9000'].onAutoForward = 'silent';
    const patched = customizeFile(file, encode(original), encode(current), config);
    expect(JSON.parse(patched.content.toString()).portsAttributes['9000']).toEqual(current.portsAttributes['9000']);
  });

  it('restores a missing renamed entry at a free destination', () => {
    const current = configured();
    delete current.portsAttributes['15333'];
    const patched = customizeFile(file, source, encode(current), config);
    expect(JSON.parse(patched.content.toString()).portsAttributes['15333']).toEqual(configured().portsAttributes['15333']);
    expect(patched.changes).toHaveProperty('portsAttributes');
  });

  it.each(['occupied destination', 'duplicate entry', 'invalid entry', 'missing label'])('rejects %s without overwriting entries', (scenario) => {
    const current = template();
    if (scenario === 'occupied destination') current.portsAttributes['6173'] = { label: 'Developer service', protocol: 'https' };
    if (scenario === 'duplicate entry') current.portsAttributes['6173'] = structuredClone(current.portsAttributes['5173']);
    if (scenario === 'invalid entry') current.portsAttributes['5173'] = [];
    if (scenario === 'missing label') delete current.portsAttributes['5173'].label;
    const buffer = encode(current);
    expect(() => customizeFile(file, source, buffer, config)).toThrow(/managed configuration/);
    expect(buffer).toEqual(encode(current));
  });

  it.each([
    { server: 5173, client: 5165, database: 14333 },
    { server: 5173, client: 14333, database: 5165 },
    { server: 5173, client: 6173, database: 15333 },
  ])('handles overlapping ports and reruns for %j', (ports) => {
    const inputs = { ...config, ports };
    const current = template();
    current.portsAttributes['5165'].protocol = 'https';
    current.portsAttributes['5173'].onAutoForward = 'silent';
    delete current.portsAttributes['14333'].onAutoForward;
    const patched = customizeFile(file, source, encode(current), inputs);
    const result = JSON.parse(patched.content.toString());
    expect(Object.keys(result.portsAttributes).sort()).toEqual(Object.values(ports).map(String).sort());
    expect(result.portsAttributes[ports.server].protocol).toBe('https');
    expect(result.portsAttributes[ports.client]).toEqual({
      label: `Vite Dev Server (Internal - Use ${ports.server})`, onAutoForward: 'silent',
    });
    expect(result.portsAttributes[ports.database]).toEqual({ label: 'SQL Server (Internal)' });
    const rerun = customizeFile(file, source, patched.content, inputs);
    expect(rerun.content).toBe(patched.content);
    expect(rerun.changes).toEqual({});
  });

  it.each([false, true])('rejects ambiguous label ownership in overlapping keys (missing entry=%s)', (missing) => {
    const original = template();
    // Keep the client first in numeric key order so template role discovery succeeds.
    original.containerEnv.ASPNETCORE_URLS = 'http://0.0.0.0:6000';
    original.forwardPorts = [6000];
    original.portsAttributes['6000'] = original.portsAttributes['5165'];
    delete original.portsAttributes['5165'];
    original.portsAttributes['6000'].label = original.portsAttributes['5173'].label;
    const current = structuredClone(original);
    if (missing) delete current.portsAttributes['6000'];
    const inputs = { ...config, ports: { server: 5173, client: 6000, database: 14333 } };
    expect(() => customizeFile(file, encode(original), encode(current), inputs)).toThrow(/managed configuration/);
  });

  it('rejects a configured port colliding with an unrelated template entry', () => {
    const original = template();
    original.portsAttributes['6173'] = { label: 'Additional template service' };
    expect(() => customizeFile(file, encode(original), encode(original), config)).toThrow(/managed configuration/);
  });
});
