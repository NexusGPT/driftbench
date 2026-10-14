import { appendFileSync, closeSync, openSync, readSync, writeSync } from 'node:fs';
import { join } from 'node:path';

/** A JSON array whose entries stay on disk, including diagnostics proportional to generated output. */
export class DiskArray<T> {
  readonly path: string;
  length = 0;

  constructor(directory: string, name: string) {
    this.path = join(directory, name);
    const fd = openSync(this.path, 'wx');
    closeSync(fd);
  }

  push(value: T): void {
    appendFileSync(this.path, `${JSON.stringify(value)}\n`);
    this.length += 1;
  }

  *[Symbol.iterator](): Generator<T> {
    const fd = openSync(this.path, 'r');
    const buffer = Buffer.alloc(64 * 1024);
    let pending = Buffer.alloc(0);
    try {
      for (let length = readSync(fd, buffer); length > 0; length = readSync(fd, buffer)) {
        pending = Buffer.concat([pending, buffer.subarray(0, length)]);
        let start = 0;
        for (let end = pending.indexOf(10, start); end >= 0; end = pending.indexOf(10, start)) {
          yield JSON.parse(pending.subarray(start, end).toString('utf8')) as T;
          start = end + 1;
        }
        pending = Buffer.from(pending.subarray(start));
      }
      if (pending.length > 0) throw new Error(`Incomplete spool record in ${this.path}`);
    } finally {
      closeSync(fd);
    }
  }
}

/** Writes nested disk arrays without materialising them or a report-sized string. */
export function writeDiskJson(path: string, value: unknown): void {
  const fd = openSync(path, 'w');
  const write = (text: string) => writeSync(fd, text);
  const render = (item: unknown): void => {
    if (item instanceof DiskArray || Array.isArray(item)) {
      write('[');
      let separator = '';
      for (const entry of item) {
        write(separator);
        render(entry);
        separator = ',';
      }
      write(']');
    } else if (item !== null && typeof item === 'object') {
      write('{');
      let separator = '';
      for (const [key, entry] of Object.entries(item)) {
        if (entry === undefined) continue;
        write(`${separator}${JSON.stringify(key)}:`);
        render(entry);
        separator = ',';
      }
      write('}');
    } else write(JSON.stringify(item) ?? 'null');
  };
  try {
    render(value);
    write('\n');
  } finally {
    closeSync(fd);
  }
}
