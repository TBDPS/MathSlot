declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readFileSync(path: string): Uint8Array;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}

declare module 'node:module' {
  export function createRequire(filename: string | URL): (id: string) => unknown;
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
}

interface ImportMeta {
  readonly dirname: string;
  readonly url: string;
}
