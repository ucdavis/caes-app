import { isDeepStrictEqual } from 'node:util';
import { CommandError } from './errors.js';
import { parseJsonObject, serializeJsonObject } from './json-edit.js';
import type { ResolvedInitInputs, TemplateFile } from './init-types.js';

export interface FilePatch { content: Buffer; changes: Record<string, unknown> }
type ObjectValue = Record<string, any>;
type PortMapping = ReadonlyMap<string, string>;
type Ports = ResolvedInitInputs['ports'];

const vitePortTrivia = String.raw`(?:[\t ]|/\*(?:[^*\r\n]|\*(?!/))*\*/)*`;
const vitePortPattern = new RegExp(
  String.raw`^([\t ]*port[\t ]*:[\t ]*)(0|[1-9]\d*)${vitePortTrivia}(,?)${vitePortTrivia}(?://[^\r\n]*)?\r?$`, 'gm',
);

function incompatible(file: string, setting?: string): never {
  throw new CommandError(`Unsupported or manually changed managed configuration in ${file}${setting ? ` (${setting})` : ''}. Restore the template/generated value and retry.`, {
    code: 'conflict', exitCode: 2,
  });
}

export class TemplateConfigurationError extends CommandError {
  constructor(readonly file: string, setting: string) {
    super(`Unsupported template configuration in ${file} (${setting}). Update the CLI or report this template incompatibility; no destination changes were applied.`, {
      code: 'template-error', exitCode: 2,
    });
  }
}

function validPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535;
}

function httpPort(value: string): number {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
  // URL normalizes explicit :80/:443 away; these are still valid template ports.
  return Number(url.port || (url.protocol === 'http:' ? 80 : 443));
}

export function readTemplateJson(files: Map<string, TemplateFile>, file: string): ObjectValue {
  const entry = files.get(file);
  if (!entry) return incompatible(file);
  return parseJsonObject(entry.content.toString('utf8'), file).value;
}

export function templateDefaults(files: Map<string, TemplateFile>): ResolvedInitInputs['ports'] {
  const seen = new Set<number>();
  const readPort = (file: string, setting: string, extract: (text: string) => number): number => {
    try {
      const port = extract(files.get(file)!.content.toString());
      if (!validPort(port) || seen.has(port)) throw new Error();
      seen.add(port);
      return port;
    } catch {
      throw new TemplateConfigurationError(file, `${setting}: expected a valid, distinct port`);
    }
  };
  return {
    server: readPort('server/Properties/launchSettings.json', 'profiles.http-cli.applicationUrl',
      (text) => httpPort(JSON.parse(text).profiles['http-cli'].applicationUrl)),
    client: readPort('client/vite.config.ts', 'server.port',
      (text) => matchVitePort(text).value),
    database: readPort('.devcontainer/docker-compose.yml', 'SQL host port',
      (text) => Number(singleMatch(text, /^[\t ]*-[\t ]*"(\d+):1433"[\t ]*\r?$/gm, '.devcontainer/docker-compose.yml')[1])),
  };
}

function singleMatch(text: string, pattern: RegExp, file: string): RegExpMatchArray {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) return incompatible(file);
  return matches[0]!;
}

function matchVitePort(text: string): { value: number; offset: number; length: number } {
  const file = 'client/vite.config.ts';
  // Count candidates anywhere, beyond the strict literal matcher, so inline or
  // non-literal duplicates cannot be ignored.
  singleMatch(text, /\bport[\t ]*:/g, file);
  const match = singleMatch(text, vitePortPattern, file);
  const value = Number(match[2]);
  if (!validPort(value)) return incompatible(file, 'server.port');
  if (!match[3]) {
    // Without a comma, a newline/comment may continue an expression. Only an
    // object close (or EOF for a standalone property) can terminate this value.
    const following = text.slice(match.index! + match[0].length)
      .replace(/^(?:\s+|\/\/[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*/, '');
    if (following && !following.startsWith('}')) return incompatible(file, 'server.port');
  }
  return { value, offset: match.index! + match[1]!.length, length: match[2]!.length };
}

export function customizeFile(file: string, source: Buffer, current: Buffer, config: ResolvedInitInputs, defaults: Ports): FilePatch {
  const changes: Record<string, unknown> = {};
  if (['package.json', 'package-lock.json', 'client/package.json', 'client/package-lock.json',
    'server/appsettings.json', 'server/appsettings.Development.json',
    'server/Properties/launchSettings.json', '.devcontainer/devcontainer.json'].includes(file)) {
    let original: ObjectValue;
    try { original = parseJsonObject(source.toString(), file).value; } catch (error) {
      if (file === '.devcontainer/devcontainer.json') throw new TemplateConfigurationError(file, 'JSON object');
      throw error;
    }
    const desired = structuredClone(original);
    let portMapping: PortMapping | undefined;
    try { portMapping = configureJson(file, desired, config, defaults); } catch (error) {
      if (error instanceof CommandError) throw error;
      return incompatible(file);
    }
    const parsed = parseJsonObject(current.toString(), file);
    const managed = managedPaths(file, original, desired);
    const merged = mergeChanges(original, desired, parsed.value, [], changes, file, managed, portMapping);
    return { content: Object.keys(changes).length ? Buffer.from(serializeJsonObject(merged, parsed)) : current, changes };
  }
  let text = current.toString();
  const original = source.toString();
  const edit = (label: string, pattern: RegExp, replacement: (match: RegExpMatchArray) => string) => {
    const old = singleMatch(original, pattern, file);
    const found = singleMatch(text, pattern, file);
    const next = replacement(old);
    if (found[0] !== old[0] && found[0] !== next) return incompatible(file);
    if (found[0] !== next) {
      text = text.slice(0, found.index!) + next + text.slice(found.index! + found[0].length);
      changes[label] = { before: found[0], after: next };
    }
  };
  if (file === 'client/vite.config.ts') {
    const old = matchVitePort(original);
    const found = matchVitePort(text);
    const next = config.ports.client;
    if (found.value !== old.value && found.value !== next) return incompatible(file, 'server.port');
    if (found.value !== next) {
      text = text.slice(0, found.offset) + next + text.slice(found.offset + found.length);
      changes['server.port'] = { before: found.value, after: next };
    }
    edit('backend fallback', /(['"])http:\/\/localhost:\d+\1/g, (m) => `${m[1]}http://localhost:${config.ports.server}${m[1]}`);
  } else if (file === 'server/server.csproj') {
    edit('SpaProxyServerUrl', /<SpaProxyServerUrl>[^<]+<\/SpaProxyServerUrl>/g,
      () => `<SpaProxyServerUrl>http://localhost:${config.ports.client}</SpaProxyServerUrl>`);
  } else if (file === '.devcontainer/docker-compose.yml') {
    // Match only the managed value so local indentation and CRLF survive resume.
    edit('SQL host port', /(?<=^[\t ]*-[\t ]*")\d+(?=:1433"[\t ]*\r?$)/gm,
      () => String(config.ports.database));
  } else return { content: current, changes };
  return { content: Object.keys(changes).length ? Buffer.from(text) : current, changes };
}

function devcontainerPortMapping(value: ObjectValue, ports: Ports, defaults: Ports): PortMapping {
  const fail = (setting: string): never => { throw new TemplateConfigurationError('.devcontainer/devcontainer.json', setting); };
  if (!Object.values(defaults).every(validPort) || new Set(Object.values(defaults)).size !== 3) {
    fail('template ports: expected valid, distinct ports');
  }
  if (typeof value.name !== 'string') fail('name');
  const url = value.containerEnv?.ASPNETCORE_URLS;
  try {
    if (typeof url !== 'string' || !/:\d+$/.test(url) || httpPort(url) !== defaults.server) throw new Error();
  } catch { fail('containerEnv.ASPNETCORE_URLS: expected the template server port'); }
  if (!Array.isArray(value.forwardPorts) || !value.forwardPorts.every(validPort)) fail('forwardPorts');
  if (!value.portsAttributes || typeof value.portsAttributes !== 'object' || Array.isArray(value.portsAttributes)) fail('portsAttributes');
  for (const port of Object.values(defaults)) {
    const entry = value.portsAttributes[port];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`portsAttributes.${port}`);
    if (typeof entry.label !== 'string') fail(`portsAttributes.${port}.label`);
  }
  return new Map((['server', 'client', 'database'] as const).map((role) => [String(defaults[role]), String(ports[role])]));
}

function configureJson(file: string, value: ObjectValue, config: ResolvedInitInputs, defaults: Ports): PortMapping | undefined {
  const { appId, displayName, ports } = config;
  const requireString = (text: unknown): string => { if (typeof text !== 'string') throw new Error(); return text; };
  const replaceOnce = (text: unknown, regex: RegExp, replacement: string): string => {
    const input = requireString(text);
    singleMatch(input, regex, file);
    return input.replace(regex, () => replacement);
  };
  if (/^(client\/)?package(-lock)?\.json$/.test(file)) {
    requireString(value.name);
    value.name = file.startsWith('client/') ? `${appId}-client` : appId;
    if (file.endsWith('package-lock.json')) {
      requireString(value.packages[''].name);
      value.packages[''].name = value.name;
    }
    if (file === 'package.json') {
      for (const name of ['db:up', 'db:down', 'db:logs']) {
        value.scripts[name] = replaceOnce(value.scripts[name], /(?<=docker compose -p )[a-zA-Z0-9_-]+/g, `${appId}_devcontainer`);
      }
      for (const name of ['start:client:debug', 'start:client:when-server-ready']) {
        value.scripts[name] = replaceOnce(value.scripts[name], /http-get:\/\/127\.0\.0\.1:\d+\/health/g, `http-get://127.0.0.1:${ports.server}/health`);
      }
    }
  } else if (file.startsWith('server/appsettings')) {
    requireString(value.Smtp.FromName);
    requireString(value.Notification.DefaultAppName);
    value.Smtp.FromName = displayName;
    value.Notification.DefaultAppName = displayName;
    if (file.includes('Development')) {
      value.Notification.BaseUrl = replaceOnce(value.Notification.BaseUrl, /^http:\/\/localhost:\d+$/g, `http://localhost:${ports.client}`);
      value.ConnectionStrings.DefaultConnection = replaceOnce(value.ConnectionStrings.DefaultConnection,
        /(?<=Server=localhost,)\d+(?=;)/g, String(ports.database));
    } else {
      requireString(value.Auth.ClientId);
      if (!/^\/[^\s]*$/.test(requireString(value.Auth.CallbackPath))) throw new Error();
    }
  } else if (file.endsWith('launchSettings.json')) {
    for (const profile of ['http', 'http-cli']) {
      const url = new URL(value.profiles[profile].applicationUrl);
      url.port = String(ports.server);
      value.profiles[profile].applicationUrl = url.origin;
    }
  } else if (file === '.devcontainer/devcontainer.json') {
    const mapping = devcontainerPortMapping(value, ports, defaults);
    value.name = `${displayName} (React + .NET + SQL)`;
    value.containerEnv.ASPNETCORE_URLS = replaceOnce(value.containerEnv.ASPNETCORE_URLS, /:\d+$/g, `:${ports.server}`);
    value.forwardPorts = value.forwardPorts.map((port: number) => mapping.has(String(port)) ? Number(mapping.get(String(port))) : port);
    const attrs: ObjectValue = {};
    for (const [key, attributes] of Object.entries(value.portsAttributes)) {
      const newKey = mapping.get(key) ?? key;
      if (Object.hasOwn(attrs, newKey)) return incompatible(file, `portsAttributes.${newKey}: destination port is occupied`);
      attrs[newKey] = attributes;
    }
    if (attrs[ports.client].label === `Vite Dev Server (Internal - Use ${defaults.server})`) {
      attrs[ports.client].label = `Vite Dev Server (Internal - Use ${ports.server})`;
    }
    value.portsAttributes = attrs;
    return mapping;
  }
}

function managedPaths(file: string, before: ObjectValue, after: ObjectValue): Set<string> {
  const paths: string[] = [];
  if (/^(client\/)?package(-lock)?\.json$/.test(file)) {
    paths.push('name');
    if (file.endsWith('package-lock.json')) paths.push('packages..name');
    if (file === 'package.json') paths.push(...['db:up', 'db:down', 'db:logs', 'start:client:debug', 'start:client:when-server-ready'].map((name) => `scripts.${name}`));
  } else if (file.startsWith('server/appsettings')) {
    paths.push('Smtp.FromName', 'Notification.DefaultAppName');
    if (file.includes('Development')) paths.push('Notification.BaseUrl', 'ConnectionStrings.DefaultConnection');
  } else if (file.endsWith('launchSettings.json')) paths.push('profiles.http.applicationUrl', 'profiles.http-cli.applicationUrl');
  else if (file === '.devcontainer/devcontainer.json') {
    paths.push('name', 'containerEnv.ASPNETCORE_URLS');
    paths.push(...before.forwardPorts.map((_port: unknown, index: number) => `forwardPorts.${index}`));
    paths.push(...Object.keys(after.portsAttributes).map((key) => `portsAttributes.${key}.label`));
  }
  return new Set(paths);
}

// Three-way merge only managed leaves. Validate even unchanged defaults: a manual
// port change must not silently disagree with the manifest and callback instructions.
function mergeChanges(before: any, after: any, current: any, path: string[], changes: Record<string, unknown>, file: string, managed: Set<string>, portMapping?: PortMapping): any {
  const pathName = path.join('.');
  if (file === '.devcontainer/devcontainer.json' && pathName === 'portsAttributes' &&
      portMapping && [...portMapping].some(([oldKey, newKey]) => oldKey !== newKey)) {
    return mergePortAttributes(before, after, current, changes, file, managed, portMapping);
  }
  if (file === 'server/appsettings.Development.json' && pathName === 'ConnectionStrings.DefaultConnection') {
    // Only the host port is managed; developer credentials and other connection
    // options may have changed since initialization and must survive a rerun.
    if (typeof current !== 'string') return incompatible(file, pathName || 'JSON object');
    const pattern = /(?<=Server=localhost,)\d+(?=;)/g;
    const oldPort = singleMatch(before, pattern, file)[0];
    const newPort = singleMatch(after, pattern, file)[0];
    const currentPort = singleMatch(current, pattern, file)[0];
    if (currentPort !== oldPort && currentPort !== newPort) return incompatible(file, pathName || 'JSON object');
    if (currentPort === newPort) return current;
    const next = current.replace(pattern, newPort);
    changes[pathName] = { before: current, after: next };
    return next;
  }
  const ownsPath = managed.has(pathName);
  if (isDeepStrictEqual(before, after)) {
    if (ownsPath) { if (!isDeepStrictEqual(current, after)) return incompatible(file, pathName || 'JSON object'); return current; }
    if (![...managed].some((key) => !pathName || key.startsWith(`${pathName}.`))) return current;
  }
  if (before && after && typeof before === 'object' && typeof after === 'object' &&
      Array.isArray(before) === Array.isArray(after)) {
    if (!current || typeof current !== 'object' || Array.isArray(current) !== Array.isArray(before)) return incompatible(file, pathName || 'JSON object');
    const result = structuredClone(current);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const own = (object: ObjectValue, name: string) => Object.hasOwn(object, name) ? object[name] : undefined;
      const next = mergeChanges(own(before, key), own(after, key), own(current, key), [...path, key], changes, file, managed, portMapping);
      if (next === undefined) delete result[key];
      else Object.defineProperty(result, key, { value: next, enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  if (isDeepStrictEqual(current, after)) return current;
  if (!isDeepStrictEqual(current, before)) return incompatible(file, pathName || 'JSON object');
  changes[path.join('.')] = { before, after };
  return after;
}

function mergePortAttributes(before: ObjectValue, after: ObjectValue, current: any,
  changes: Record<string, unknown>, file: string, managed: Set<string>, mapping: PortMapping): ObjectValue {
  if (!current || typeof current !== 'object' || Array.isArray(current)) return incompatible(file, 'portsAttributes');
  const consumed = new Set<string>();
  const relevant = new Set<string>();
  const entries = Object.keys(before).map((oldKey) => {
    const newKey = mapping.get(oldKey) ?? oldKey;
    const keys = [...new Set([oldKey, newKey])];
    keys.forEach((key) => relevant.add(key));
    // Labels identify ownership when configured ports overlap template ports.
    // Read every candidate before moving anything, including for swaps.
    const candidates = keys.filter((key) => Object.hasOwn(current, key) &&
      current[key] && typeof current[key] === 'object' && !Array.isArray(current[key]) &&
      (current[key].label === before[oldKey].label || current[key].label === after[newKey].label));
    if (candidates.length > 1) return incompatible(file, `portsAttributes.${newKey}: ambiguous ownership`);
    const currentKey = candidates[0];
    if (currentKey === undefined) {
      // Only renamed entries had addition/restoration semantics in the union merge.
      if (oldKey === newKey) return incompatible(file, `portsAttributes.${oldKey}.label`);
    } else {
      if (consumed.has(currentKey)) return incompatible(file, `portsAttributes.${currentKey}: ambiguous ownership`);
      consumed.add(currentKey);
    }
    return { oldKey, newKey, currentKey };
  });
  // Unclaimed entries at either end are conflicting labels or occupied destinations.
  for (const key of relevant) {
    if (Object.hasOwn(current, key) && !consumed.has(key)) return incompatible(file, `portsAttributes.${key}: conflicting entry or occupied destination`);
  }
  const result = structuredClone(current);
  for (const key of consumed) delete result[key];
  for (const { oldKey, newKey, currentKey } of entries) {
    const next = currentKey === undefined ? structuredClone(after[newKey]) :
      mergeChanges(before[oldKey], after[newKey], current[currentKey], ['portsAttributes', newKey], {}, file, managed);
    Object.defineProperty(result, newKey, { value: next, enumerable: true, writable: true, configurable: true });
  }
  // A rename must trigger serialization even if no attribute leaves changed.
  if (!isDeepStrictEqual(current, result)) changes.portsAttributes = { before: current, after: result };
  return result;
}

export function patchAuth(text: string, clientId: string): string {
  const lines = text.split(/(?<=\n)/);
  const candidates = lines.map((line, index) => ({ line, index })).filter(({ line }) =>
    /^\s*(?:export\s+)?Auth__ClientId\b/.test(line));
  if (candidates.length > 1) return incompatible('server/.env (duplicate Auth__ClientId assignments)');
  if (!candidates.length) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    return text + (text && !text.endsWith('\n') ? eol : '') + `Auth__ClientId=${clientId}${eol}`;
  }
  const candidate = candidates[0]!;
  const match = candidate.line.match(/^([\t ]*(?:export[\t ]+)?Auth__ClientId[\t ]*=[\t ]*)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s#'"\r\n]*))([\t ]*(?:#[^\r\n]*)?)(\r?\n)?$/);
  if (!match) return incompatible('server/.env (ambiguous Auth__ClientId assignment)');
  const value = match[2] ?? match[3] ?? match[4];
  if (value?.toLowerCase() === clientId.toLowerCase()) return text;
  lines[candidate.index] = `${match[1]}${clientId}${match[5]}${match[6] ?? ''}`;
  return lines.join('');
}

// DotEnv.Core 3.1 treats backslashes and inner quotes literally, strips all
// boundary quotes, and expands ${...} even inside quotes. Do not JSON-escape
// values: that would change what the server reads. Reject unrepresentable input
// before writing rather than silently truncating or interpolating it.
function dotenvLiteral(key: string, value: string): string {
  if (/[\x00-\x1f\x7f]|^["']|["']$|[ \t]#|\$\{/.test(value)) {
    throw new CommandError(`Cannot safely encode ${key} in server/.env: the template dotenv parser does not support control characters, boundary quotes, inline comment markers, or variable interpolation in literal values.`, {
      code: 'conflict', exitCode: 2,
    });
  }
  const quote = value.includes('"') && !value.includes("'") ? "'" : '"';
  return `${quote}${value}${quote}`;
}

export function createLocalEnv(example: Buffer | undefined, files: Map<string, TemplateFile>, config: ResolvedInitInputs): Buffer {
  if (!example) throw new CommandError('Template is missing server/.env.example, which is required to create server/.env.', { code: 'conflict', exitCode: 2 });
  const development = readTemplateJson(files, 'server/appsettings.Development.json');
  const connection = development.ConnectionStrings?.DefaultConnection;
  if (typeof connection !== 'string') return incompatible('server/appsettings.Development.json');
  const replacements: Record<string, string | ((value: string) => string)> = {
    OTEL_SERVICE_NAME: config.appId,
    OTEL_RESOURCE_ATTRIBUTES: (value) => value.replace(/(\bservice\.namespace=)<service_namespace>/g, () => `service.namespace=${config.appId}`),
    DB_CONNECTION: connection,
    Smtp__FromName: config.displayName,
    Notification__DefaultAppName: config.displayName,
    Notification__BaseUrl: `http://localhost:${config.ports.client}`,
  };
  const seen = new Set<string>();
  const text = example.toString('utf8').split(/(?<=\n)/).map((line) => {
    const key = line.match(/^[\t ]*(?:export[\t ]+)?([\w]+)\b/)?.[1];
    if (!key || !Object.hasOwn(replacements, key)) return line;
    if (seen.has(key)) return incompatible(`server/.env.example (duplicate ${key} assignments)`);
    seen.add(key);
    const match = line.match(/^([\t ]*(?:export[\t ]+)?\w+[\t ]*=[\t ]*)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s#'"\r\n]*))([\t ]*(?:#[^\r\n]*)?)(\r?\n)?$/);
    if (!match) return incompatible(`server/.env.example (${key} assignment)`);
    const replacement = replacements[key]!;
    const value = typeof replacement === 'function' ? replacement(match[2] ?? match[3] ?? match[4] ?? '') : replacement;
    return `${match[1]}${dotenvLiteral(key, value)}${match[5]}${match[6] ?? ''}`;
  }).join('');
  return Buffer.from(config.authClientId ? patchAuth(text, config.authClientId) : text);
}

export function authInstructions(config: ResolvedInitInputs, files: Map<string, TemplateFile>): string[] {
  const base = readTemplateJson(files, 'server/appsettings.json');
  const dev = readTemplateJson(files, 'server/appsettings.Development.json');
  const launch = readTemplateJson(files, 'server/Properties/launchSettings.json');
  const callback = dev.Auth?.CallbackPath ?? base.Auth?.CallbackPath;
  if (typeof callback !== 'string' || !/^\/[^\s]*$/.test(callback)) return incompatible('Auth.CallbackPath');
  const urls = [`http://localhost:${config.ports.client}${callback}`, `http://localhost:${config.ports.server}${callback}`];
  const sslPort = launch.iisSettings?.iisExpress?.sslPort;
  if (sslPort) urls.push(`https://localhost:${sslPort}${callback}`);
  else if (launch.iisSettings?.iisExpress?.applicationUrl) urls.push(`${new URL(launch.iisSettings.iisExpress.applicationUrl).origin}${callback}`);
  return [
    'Scaffolding does not verify runtime readiness. Install dependencies and configure local services before starting the app.',
    'Missing server/.env files are created from the template example with known local settings. Review the remaining placeholders for auth, telemetry, and SMTP before using those services; existing files are preserved except for explicitly supplied auth updates.',
    'In Microsoft Entra App registrations, create or open the user sign-in application, verify the tenant/domain and supported accounts, and configure Web redirect URIs with ID tokens enabled.',
    'The user sign-in registration is separate from the GitHub deployment managed identity; do not use the deployment identity client ID for sign-in.',
    `Register these callback URLs (based on project JSON configuration): ${[...new Set(urls)].join(', ')}`,
    config.authClientId ? 'The supplied user sign-in client ID is configured only in server/.env; verify the registration and redirect URIs manually.'
      : 'Set Auth__ClientId in git-ignored server/.env to your user sign-in Application (client) ID. Do not use the GitHub deployment managed identity client ID.',
    'Configuration precedence: appsettings.json, environment-specific appsettings, .env, .env.<environment>, then process environment; later values win. Higher-precedence callback/port overrides require corresponding redirect URIs.',
  ];
}
