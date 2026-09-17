import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { customizeFile, templateDefaults } from '../src/init-patches.js';
import type { ResolvedInitInputs, TemplateFile } from '../src/init-types.js';

const file = '.devcontainer/devcontainer.json';
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/template.json', import.meta.url), 'utf8'));
const source = Buffer.from(fixtures[file]);
const legacySource = readFileSync(new URL('./fixtures/devcontainer-legacy.json', import.meta.url));
const config: ResolvedInitInputs = {
  appId: 'demo-app', displayName: 'Demo App', ports: { server: 6165, client: 6173, database: 15333 },
};
const templatePorts = { server: 5165, client: 5173, database: 14333 };
const encode = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const template = () => JSON.parse(source.toString());
const configured = (inputs = config) => JSON.parse(customizeFile(file, source, source, inputs, templatePorts).content.toString());

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
      const patched = customizeFile(file, source, encode(current), inputs, templatePorts);
      const result = JSON.parse(patched.content.toString());
      expect(result.portsAttributes).toEqual({
        [inputs.ports.server]: { label: 'ASP.NET Core API', onAutoForward: 'ignore', protocol: 'https' },
        [inputs.ports.client]: { label: 'Web App (Vite)', onAutoForward: 'silent' },
        [inputs.ports.database]: { label: 'SQL Server (Internal)' },
        '9000': current.portsAttributes['9000'],
      });
      const rerun = customizeFile(file, source, patched.content, inputs, templatePorts);
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
    expect(() => customizeFile(file, source, encode(current), inputs, templatePorts)).toThrow(/managed configuration/);
  });

  it('records and serializes a key-only move with all other settings already configured', () => {
    const current = configured();
    current.portsAttributes['14333'] = current.portsAttributes['15333'];
    delete current.portsAttributes['15333'];
    current.portsAttributes['14333'].protocol = 'https';
    const patched = customizeFile(file, source, encode(current), config, templatePorts);
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
    const patched = customizeFile(file, encode(original), encode(current), config, templatePorts);
    expect(JSON.parse(patched.content.toString()).portsAttributes['9000']).toEqual(current.portsAttributes['9000']);
  });

  it('restores a missing renamed entry at a free destination', () => {
    const current = configured();
    delete current.portsAttributes['15333'];
    const patched = customizeFile(file, source, encode(current), config, templatePorts);
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
    expect(() => customizeFile(file, source, buffer, config, templatePorts)).toThrow(/managed configuration/);
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
    const patched = customizeFile(file, source, encode(current), inputs, templatePorts);
    const result = JSON.parse(patched.content.toString());
    expect(Object.keys(result.portsAttributes).sort()).toEqual(Object.values(ports).map(String).sort());
    expect(result.portsAttributes[ports.server].protocol).toBe('https');
    expect(result.portsAttributes[ports.client]).toEqual({
      label: 'Web App (Vite)', onAutoForward: 'silent',
    });
    expect(result.portsAttributes[ports.database]).toEqual({ label: 'SQL Server (Internal)' });
    const rerun = customizeFile(file, source, patched.content, inputs, templatePorts);
    expect(rerun.content).toBe(patched.content);
    expect(rerun.changes).toEqual({});
  });

  it.each([false, true])('rejects ambiguous label ownership in overlapping keys (missing entry=%s)', (missing) => {
    const original = template();
    // Source port settings identify roles even when labels are identical.
    original.containerEnv.ASPNETCORE_URLS = 'http://0.0.0.0:6000';
    original.forwardPorts = [6000];
    original.portsAttributes['6000'] = original.portsAttributes['5165'];
    delete original.portsAttributes['5165'];
    original.portsAttributes['6000'].label = original.portsAttributes['5173'].label;
    const current = structuredClone(original);
    if (missing) delete current.portsAttributes['6000'];
    const inputs = { ...config, ports: { server: 5173, client: 6000, database: 14333 } };
    expect(() => customizeFile(file, encode(original), encode(current), inputs, { ...templatePorts, server: 6000 })).toThrow(/managed configuration/);
  });

  it('rejects a configured port colliding with an unrelated template entry', () => {
    const original = template();
    original.portsAttributes['6173'] = { label: 'Additional template service' };
    expect(() => customizeFile(file, encode(original), encode(original), config, templatePorts)).toThrow(/managed configuration/);
  });
});


describe('template port compatibility', () => {
  it.each([
    { generation: 'current', source }, { generation: 'legacy', source: legacySource },
  ])('initializes and resumes $generation templates with default, custom, and swapped ports', ({ source, generation }) => {
    const original = JSON.parse(source.toString());
    for (const ports of [templatePorts, config.ports, { server: 5173, client: 5165, database: 14333 }]) {
      const inputs = { ...config, ports };
      const patched = customizeFile(file, source, source, inputs, templatePorts);
      const result = JSON.parse(patched.content.toString());
      expect(result.forwardPorts).toEqual(generation === 'legacy' ? [ports.server] : [ports.server, ports.client]);
      expect(result.containerEnv.ASPNETCORE_URLS).toBe(`http://0.0.0.0:${ports.server}`);
      expect(result.portsAttributes[ports.client]).toEqual({
        label: generation === 'legacy' ? `Vite Dev Server (Internal - Use ${ports.server})` : 'Web App (Vite)',
        onAutoForward: 'openBrowser',
      });
      expect(result.portsAttributes[ports.server]).toEqual(original.portsAttributes[templatePorts.server]);
      expect(result.portsAttributes[ports.database]).toEqual(original.portsAttributes[templatePorts.database]);
      expect(customizeFile(file, source, patched.content, inputs, templatePorts)).toEqual({ content: patched.content, changes: {} });
      // Resume a partially applied file whose attributes still use template keys.
      result.portsAttributes = structuredClone(original.portsAttributes);
      result.portsAttributes[templatePorts.client].protocol = 'https';
      const partial = customizeFile(file, source, encode(result), inputs, templatePorts);
      expect(JSON.parse(partial.content.toString()).portsAttributes[ports.client].protocol).toBe('https');
      expect(customizeFile(file, source, partial.content, inputs, templatePorts).changes).toEqual({});
    }
  });

  it('uses configured source ports even when every role label and port changes', () => {
    const original = template();
    const defaults = { server: 7100, client: 7200, database: 7300 };
    original.containerEnv.ASPNETCORE_URLS = 'http://0.0.0.0:7100';
    original.forwardPorts = [7100, 7200, 9000];
    original.portsAttributes = {
      '7100': { label: 'Service endpoint' },
      '7200': { label: 'Browser interface', onAutoForward: 'openBrowser' },
      '7300': { label: 'Data endpoint' },
      '9000': { label: 'Additional service', protocol: 'https' },
    };
    const buffer = encode(original);
    const patched = customizeFile(file, buffer, buffer, config, defaults);
    const result = JSON.parse(patched.content.toString());
    expect(result.forwardPorts).toEqual([6165, 6173, 9000]);
    expect(result.portsAttributes).toEqual({
      '6165': original.portsAttributes['7100'], '6173': original.portsAttributes['7200'],
      '15333': original.portsAttributes['7300'], '9000': original.portsAttributes['9000'],
    });
    expect(customizeFile(file, buffer, patched.content, config, defaults).changes).toEqual({});
  });

  it.each([{ protocol: 'http', server: 80 }, { protocol: 'https', server: 443 }])(
    'accepts the explicit default $protocol port', ({ protocol, server }) => {
      const original = template();
      original.containerEnv.ASPNETCORE_URLS = `${protocol}://0.0.0.0:${server}`;
      original.forwardPorts = [server, 5173];
      original.portsAttributes[server] = original.portsAttributes['5165'];
      delete original.portsAttributes['5165'];
      const buffer = encode(original);
      const patched = customizeFile(file, buffer, buffer, config, { ...templatePorts, server });
      expect(JSON.parse(patched.content.toString()).containerEnv.ASPNETCORE_URLS).toBe(`${protocol}://0.0.0.0:6165`);
    },
  );

  it.each(['Vite Dev Server (Internal - Use 9999)', 'Vite Dev Server (Internal - Use 5165) custom'])(
    'preserves labels that are not an exact legacy match: %s', (label) => {
      const original = template();
      original.portsAttributes['5173'].label = label;
      const buffer = encode(original);
      expect(JSON.parse(customizeFile(file, buffer, buffer, config, templatePorts).content.toString())
        .portsAttributes['6173'].label).toBe(label);
    },
  );

  it.each([
    ['missing entry', 'portsAttributes.5173'], ['invalid entry', 'portsAttributes.5173'],
    ['missing label', 'portsAttributes.5173.label'], ['invalid attributes', 'portsAttributes'],
    ['inconsistent URL', 'containerEnv.ASPNETCORE_URLS'], ['invalid URL', 'containerEnv.ASPNETCORE_URLS'],
    ['missing environment', 'containerEnv.ASPNETCORE_URLS'], ['invalid forwarding', 'forwardPorts'],
    ['invalid name', 'name'],
  ])('reports unsupported template %s without exposing contents', (scenario, setting) => {
    const original = template();
    if (scenario === 'missing entry') delete original.portsAttributes['5173'];
    if (scenario === 'invalid entry') original.portsAttributes['5173'] = [];
    if (scenario === 'missing label') delete original.portsAttributes['5173'].label;
    if (scenario === 'invalid attributes') original.portsAttributes = [];
    if (scenario === 'inconsistent URL') original.containerEnv.ASPNETCORE_URLS = 'http://0.0.0.0:9999';
    if (scenario === 'invalid URL') original.containerEnv.ASPNETCORE_URLS = 'sentinel-secret';
    if (scenario === 'missing environment') delete original.containerEnv;
    if (scenario === 'invalid forwarding') original.forwardPorts = [0];
    if (scenario === 'invalid name') original.name = null;
    const buffer = encode(original);
    expect(() => customizeFile(file, buffer, buffer, config, templatePorts)).toThrow(expect.objectContaining({
      code: 'template-error', exitCode: 2, message: expect.stringContaining(setting!),
    }));
    try { customizeFile(file, buffer, buffer, config, templatePorts); } catch (error) {
      expect(String(error)).not.toMatch(/sentinel-secret|Restore the template/);
    }
    expect(buffer).toEqual(encode(original));
  });

  it.each([0, 65536, 1.5, NaN, 5173])('rejects invalid or duplicate source port %s', (server) => {
    expect(() => customizeFile(file, source, source, config, { ...templatePorts, server })).toThrow(
      expect.objectContaining({ code: 'template-error', exitCode: 2, message: expect.stringContaining('template ports') }),
    );
  });

  it('distinguishes invalid source JSON from invalid destination JSON', () => {
    const invalid = Buffer.from('{"sentinel-secret":');
    expect(() => customizeFile(file, invalid, invalid, config, templatePorts)).toThrow(
      expect.objectContaining({ code: 'template-error', message: expect.stringContaining('JSON object') }),
    );
    expect(() => customizeFile(file, source, invalid, config, templatePorts)).toThrow(
      expect.objectContaining({ code: 'invalid-json' }),
    );
  });
});

describe('Vite port literals', () => {
  const name = 'client/vite.config.ts';
  const vite = (property: string) => Buffer.from(
    `const target = 'http://localhost:5165';\nexport default {\n  server: {\n${property}\n  },\n};\n`,
  );
  const source = vite('    port: 5173,');
  const defaults = (content: Buffer) => {
    const files = new Map<string, TemplateFile>(Object.entries(fixtures as Record<string, string>).map(([file, text]) =>
      [file, { content: Buffer.from(text), mode: 0o644 }]));
    files.set(name, { content, mode: 0o644 });
    return templateDefaults(files);
  };

  it.each([
    '    port: 5173 + 1,',
    '    port: 5173\n      + 1,',
    '    port: 5173 // continued\n      + 1,',
    '    port: 5173\n      /* continued\n         expression */ + 1,',
    '    port: 5173 /* comment */ + 1 /* another comment */,',
    '    port: 5173.5,',
    '    port: 5173e2,',
    '    port: 5_173,',
    '    port: 05173,',
    '    port: 0,',
    '    port: 65536,',
    '    port: getPort(),',
    '    port:\n      5173,',
    '    port: 5173 /* unclosed',
    '    host: true,',
    '    port: 5173,\n    port: 6173,',
    '    port: 5173,\n    port: 6173 + 1,',
    '    port: 5173, port: 6173,',
    '    port: 5173\n    host: true,',
  ])('rejects unsupported properties in extraction and customization: %s', (property) => {
    const invalid = vite(property);
    expect(() => defaults(invalid)).toThrow(expect.objectContaining({
      code: 'template-error', file: name, message: expect.stringContaining('server.port'),
    }));
    expect(() => customizeFile(name, invalid, invalid, config, templatePorts)).toThrow(
      expect.objectContaining({ code: 'conflict' }),
    );
    expect(() => customizeFile(name, source, invalid, config, templatePorts)).toThrow(
      expect.objectContaining({ code: 'conflict' }),
    );
  });

  it.each(['\n', '\r\n'])('rejects inline duplicates with %j line endings', (eol) => {
    for (const duplicate of ['port: 9999', 'port: 9999 + 1', 'port \t: getPort()']) {
      for (const lines of [
        ['    port: 5173,', `    host: true, ${duplicate},`],
        [`    host: true, ${duplicate},`, '    port: 5173,'],
      ]) {
        const invalid = Buffer.from(vite(lines.join('\n')).toString().replaceAll('\n', eol));
        expect(() => defaults(invalid)).toThrow(expect.objectContaining({
          code: 'template-error', file: name, message: expect.stringContaining('server.port'),
        }));
        for (const client of [templatePorts.client, config.ports.client, 9999]) {
          const inputs = { ...config, ports: { ...config.ports, client } };
          expect(() => customizeFile(name, invalid, source, inputs, templatePorts)).toThrow(
            expect.objectContaining({ code: 'conflict' }),
          );
          expect(() => customizeFile(name, source, invalid, inputs, templatePorts)).toThrow(
            expect.objectContaining({ code: 'conflict' }),
          );
        }
      }
    }
  });

  const properties = [
    '    port: 5173,',
    '\t port \t:\t 5173 \t, \t// local comment',
    '    port: 5173 /* before comma */, /* after comma */ // trailing',
    '    port: 5173 /* stars ** and / inside */ ,',
    '    port: 5173',
    '    port: 5173 // last property',
    '    port: 5173 /* last property */\n\n    // following comment\n    /* multiple\n       lines */',
  ];
  it.each(['\n', '\r\n'])('preserves current formatting and resumes with %j line endings', (eol) => {
    for (const property of properties) {
      const current = Buffer.from(vite(property).toString().replaceAll('\n', eol));
      expect(defaults(current)).toEqual(templatePorts);
      for (const port of [templatePorts.client, config.ports.client]) {
        // Keep the backend unchanged so the expected diff isolates the port span.
        const inputs = { ...config, ports: { ...templatePorts, client: port } };
        const patched = customizeFile(name, source, current, inputs, templatePorts);
        expect(patched.content.toString()).toBe(current.toString().replace('5173', String(port)));
        expect(patched.changes).toEqual(port === templatePorts.client ? {} : {
          'server.port': { before: 5173, after: port },
        });
        if (port === templatePorts.client) expect(patched.content).toBe(current);
        const resumed = customizeFile(name, source, patched.content, inputs, templatePorts);
        expect(resumed.content).toBe(patched.content);
        expect(resumed.changes).toEqual({});
        const conflicting = Buffer.from(current.toString().replace('5173', '9999'));
        expect(() => customizeFile(name, source, conflicting, inputs, templatePorts)).toThrow(
          expect.objectContaining({ code: 'conflict' }),
        );
      }
    }
  });

  it.each(['port: 5173', 'port: 5173 // comment', 'port: 5173 /* comment */\n'])(
    'accepts a standalone property ending at EOF: %s', (property) => {
      expect(defaults(Buffer.from(property))).toEqual(templatePorts);
    },
  );
});

describe('template port defaults', () => {
  const files = () => new Map(Object.entries(fixtures as Record<string, string>).map(([name, text]) =>
    [name, { content: Buffer.from(text), mode: 0o644 }]));

  it('reads all role ports and accepts CRLF Compose mappings', () => {
    const input = files();
    const compose = input.get('.devcontainer/docker-compose.yml')!;
    compose.content = Buffer.from(compose.content.toString().replace(/\r?\n/g, '\r\n'));
    expect(templateDefaults(input)).toEqual(templatePorts);
  });

  it.each([80, 443])('reads explicit HTTP(S) default port %s', (server) => {
    const input = files();
    const name = 'server/Properties/launchSettings.json';
    input.set(name, { content: encode({ profiles: { 'http-cli': {
      applicationUrl: `${server === 80 ? 'http' : 'https'}://localhost:${server}`,
    } } }), mode: 0o644 });
    expect(templateDefaults(input)).toEqual({ ...templatePorts, server });
  });

  it.each([
    ['server/Properties/launchSettings.json', '{"profiles":{"http-cli":{"applicationUrl":"sentinel-secret"}}}', 'profiles.http-cli.applicationUrl'],
    ['client/vite.config.ts', 'port: 0', 'server.port'],
    ['client/vite.config.ts', 'port: 65536', 'server.port'],
    ['client/vite.config.ts', 'port: 5173.5', 'server.port'],
    ['client/vite.config.ts', 'port: 5173e2', 'server.port'],
    ['client/vite.config.ts', 'port: 5165', 'server.port'],
    ['client/vite.config.ts', 'port: 5173, port: 6173', 'server.port'],
    ['.devcontainer/docker-compose.yml', '  - "0:1433"', 'SQL host port'],
    ['.devcontainer/docker-compose.yml', '  - "5173:1433"', 'SQL host port'],
  ])('identifies invalid source setting in %s (%s)', (name, content, setting) => {
    const input = files();
    input.set(name!, { content: Buffer.from(content!), mode: 0o644 });
    expect(() => templateDefaults(input)).toThrow(expect.objectContaining({
      code: 'template-error', exitCode: 2, file: name, message: expect.stringContaining(setting!),
    }));
    try { templateDefaults(input); } catch (error) { expect(String(error)).not.toContain('sentinel-secret'); }
  });
});
