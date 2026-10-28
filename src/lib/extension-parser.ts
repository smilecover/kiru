import type { ExtensionMeta, ExtensionType } from '../types/models';

const extensionTypes: ExtensionType[] = ['bangumi', 'manga', 'fikushon'];

export function isExtensionType(value: unknown): value is ExtensionType {
  return extensionTypes.includes(value as ExtensionType);
}

/** Mirrors Miru's `className` derivation from the package name. */
export function extensionClassName(packageName: string): string {
  let className = packageName.replace(/\./g, '');
  if (!/^[a-zA-Z]+$/.test(className)) {
    className = `${className.replace(/[^a-zA-Z]/g, '')}Renamed`;
  }
  return className || 'ExtensionRenamed';
}

function headerMap(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  const expression = /@(\w+)\s+(.*)/g;
  for (const match of source.matchAll(expression)) {
    result[match[1]] = match[2].trim();
  }
  return result;
}

/** Parses the `// ==MiruExtension==` header into metadata. */
export function parseExtensionMeta(source: string): ExtensionMeta {
  if (!source || typeof source !== 'string') {
    throw new Error('Extension source is empty');
  }
  const values = headerMap(source);
  const type = values.type;
  if (!isExtensionType(type)) {
    throw new Error(`Invalid extension type: ${type || '(missing)'}`);
  }
  const required = ['package', 'name', 'version', 'author', 'lang', 'license', 'webSite'] as const;
  for (const key of required) {
    if (!values[key]) {
      throw new Error(`Extension header is missing @${key}`);
    }
  }
  if (
    !/^[A-Za-z0-9._@+-]+$/.test(values.package) ||
    values.package.includes('..') ||
    values.package === '.'
  ) {
    throw new Error(`Invalid extension package name: ${values.package}`);
  }
  return {
    package: values.package,
    name: values.name,
    version: values.version,
    author: values.author,
    lang: values.lang,
    license: values.license,
    type,
    webSite: values.webSite,
    nsfw: values.nsfw === 'true',
    icon: values.icon,
    url: values.url,
    description: values.description,
  };
}

/** Same transformation Miru applies before evaluating an extension. */
export function transformExtensionSource(source: string, packageName: string): string {
  const className = extensionClassName(packageName);
  if (!/export default class/.test(source)) {
    throw new Error('Extension does not export a default class');
  }
  return source.replace(/export default class.*/, `class ${className} extends Extension {`);
}

export function extensionHeaderFields(source: string): Record<string, string> {
  return headerMap(source);
}
