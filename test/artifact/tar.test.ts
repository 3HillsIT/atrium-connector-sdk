import { describe, test, expect } from 'bun:test';
import { readSafeEntries, readTar, writeTar, gzip, gunzip } from '../../src/artifact/tar';
import { ConnectorArtifactError } from '../../src/artifact/errors';
import { fromUtf8, utf8 } from '../../src/artifact/digest';

/**
 * A hostile tar has to be built byte by byte — our own writer refuses to emit
 * one, which is the point. This is a minimal ustar header writer with no
 * safety of its own, so the hardening tests below drive a real parser over a
 * real archive rather than over a mocked entry list.
 */
function hostileTar(
  entries: Array<{ name: string; typeflag?: string; linkname?: string; data?: Uint8Array }>,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const entry of entries) {
    const data = entry.data ?? new Uint8Array(0);
    const block = new Uint8Array(512);
    const put = (offset: number, text: string) => block.set(utf8(text), offset);

    put(0, entry.name);
    put(100, '0000644\0');
    put(108, '0000000\0');
    put(116, '0000000\0');
    put(124, data.length.toString(8).padStart(11, '0') + '\0');
    put(136, '00000000000\0');
    block[156] = (entry.typeflag ?? '0').charCodeAt(0);
    if (entry.linkname) put(157, entry.linkname);
    put(257, 'ustar');
    put(263, '00');

    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i]!;
    put(148, sum.toString(8).padStart(6, '0'));
    block[154] = 0;
    block[155] = 0x20;

    chunks.push(block, data);
    const remainder = data.length % 512;
    if (remainder !== 0) chunks.push(new Uint8Array(512 - remainder));
  }
  chunks.push(new Uint8Array(1024));

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function refusalOf(run: () => unknown): ConnectorArtifactError {
  try {
    run();
  } catch (err) {
    if (err instanceof ConnectorArtifactError) return err;
    throw err;
  }
  throw new Error('expected the archive to be refused, but it was accepted');
}

describe('tar round trip', () => {
  test('files come back with their names and bytes intact', () => {
    const files = [
      { name: 'manifest.json', data: utf8('{"id":"x"}') },
      { name: 'actions/list_things.js', data: utf8('export const a = 1;') },
    ];
    const read = readSafeEntries(writeTar(files), 'test');
    expect([...read.keys()]).toEqual(['manifest.json', 'actions/list_things.js']);
    expect(fromUtf8(read.get('manifest.json')!)).toBe('{"id":"x"}');
  });

  test('a file whose length is an exact multiple of the block size round-trips', () => {
    const data = utf8('a'.repeat(512));
    const read = readSafeEntries(writeTar([{ name: 'a.js', data }]), 'test');
    expect(read.get('a.js')).toEqual(data);
  });

  test('an empty file round-trips', () => {
    const read = readSafeEntries(writeTar([{ name: 'empty.js', data: new Uint8Array(0) }]), 'test');
    expect(read.get('empty.js')!.length).toBe(0);
  });

  test('headers are normalized — mode 0644, uid/gid 0, mtime 0 — so nothing of the build host leaks in', () => {
    const tar = writeTar([{ name: 'a.js', data: utf8('x') }]);
    const header = tar.subarray(0, 512);
    const field = (offset: number, length: number) =>
      fromUtf8(header.subarray(offset, offset + length)).replace(/\0.*$/s, '');
    expect(field(100, 8)).toBe('0000644'); // mode
    expect(field(108, 8)).toBe('0000000'); // uid
    expect(field(116, 8)).toBe('0000000'); // gid
    expect(field(136, 12)).toBe('00000000000'); // mtime
    expect(field(257, 6)).toBe('ustar');
  });

  test('the same input produces the same bytes twice — the trivial nondeterminism is gone', () => {
    const files = [{ name: 'a.js', data: utf8('x') }];
    expect(gzip(writeTar(files))).toEqual(gzip(writeTar(files)));
  });

  test('gzip zeroes its own timestamp, which zlib would otherwise stamp in', () => {
    const compressed = gzip(utf8('hello'));
    expect([...compressed.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
    expect(compressed[9]).toBe(0xff); // OS byte: "unknown", not the build host
    expect(fromUtf8(gunzip(compressed, 'test'))).toBe('hello');
  });

  test('a corrupted header block is refused rather than misread', () => {
    const tar = writeTar([{ name: 'a.js', data: utf8('x') }]);
    tar[5]! ^= 0xff; // inside the name field, so the checksum no longer holds
    const error = refusalOf(() => readTar(tar, 'test'));
    expect(error.code).toBe('envelope-malformed');
    expect(error.message).toContain('checksum');
  });

  test('an entry claiming more data than the archive holds is refused', () => {
    const tar = hostileTar([{ name: 'a.js', data: utf8('x') }]);
    // Rewrite the size field to a value far beyond the archive's length.
    tar.set(utf8((99999).toString(8).padStart(11, '0') + '\0'), 124);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : tar[i]!;
    tar.set(utf8(sum.toString(8).padStart(6, '0')), 148);
    tar[154] = 0;
    tar[155] = 0x20;

    const error = refusalOf(() => readTar(tar, 'test'));
    expect(error.code).toBe('envelope-malformed');
  });
});

// One case each, exactly as ADR-0007 §3 requires. None of these is implied by
// a valid signature: a per-file content listing says nothing about tar
// headers, which is why the extractor is hardened independently.
describe('extractor hardening', () => {
  test('refuses a symlink, naming its target', () => {
    const tar = hostileTar([{ name: 'evil.js', typeflag: '2', linkname: '/etc/passwd' }]);
    const error = refusalOf(() => readSafeEntries(tar, 'test'));
    expect(error.code).toBe('unsafe-entry');
    expect(error.message).toContain('symlink');
    expect(error.details.linkname).toBe('/etc/passwd');
  });

  test('refuses a hardlink', () => {
    const tar = hostileTar([{ name: 'evil.js', typeflag: '1', linkname: 'manifest.json' }]);
    const error = refusalOf(() => readSafeEntries(tar, 'test'));
    expect(error.code).toBe('unsafe-entry');
    expect(error.message).toContain('hardlink');
  });

  test('refuses an absolute path', () => {
    const tar = hostileTar([{ name: '/etc/cron.d/evil', data: utf8('x') }]);
    const error = refusalOf(() => readSafeEntries(tar, 'test'));
    expect(error.code).toBe('unsafe-entry');
    expect(error.message).toContain('absolute path');
    expect(error.details.path).toBe('/etc/cron.d/evil');
  });

  test('refuses a .. traversal', () => {
    const tar = hostileTar([{ name: 'actions/../../evil.js', data: utf8('x') }]);
    const error = refusalOf(() => readSafeEntries(tar, 'test'));
    expect(error.code).toBe('unsafe-entry');
    expect(error.message).toContain('path traversal');
  });

  test('refuses a non-regular entry — a directory here, but the rule covers devices and fifos too', () => {
    const tar = hostileTar([{ name: 'actions/', typeflag: '5' }]);
    const error = refusalOf(() => readSafeEntries(tar, 'test'));
    expect(error.code).toBe('unsafe-entry');
    expect(error.message).toContain('non-regular entry');
  });

  test('refuses a duplicate entry name, so a second entry cannot shadow a hashed first one', () => {
    const tar = hostileTar([
      { name: 'actions/a.js', data: utf8('honest') },
      { name: 'actions/a.js', data: utf8('injected') },
    ]);
    const error = refusalOf(() => readSafeEntries(tar, 'test'));
    expect(error.code).toBe('unsafe-entry');
    expect(error.message).toContain('duplicate entry name');
  });

  test('refuses a pax extension entry, which is how a long or odd name would otherwise arrive', () => {
    const tar = hostileTar([{ name: 'PaxHeaders/0', typeflag: 'x', data: utf8('30 path=x\n') }]);
    const error = refusalOf(() => readSafeEntries(tar, 'test'));
    expect(error.code).toBe('unsafe-entry');
    expect(error.details.typeflag).toBe('x');
  });

  test('refuses a GNU long-name entry for the same reason', () => {
    const tar = hostileTar([{ name: '././@LongLink', typeflag: 'L', data: utf8('a'.repeat(200)) }]);
    const error = refusalOf(() => readSafeEntries(tar, 'test'));
    expect(error.code).toBe('unsafe-entry');
  });

  test('refuses a backslash-spelled traversal, which a forward-slash-only split would miss', () => {
    const tar = hostileTar([{ name: 'actions\\..\\..\\evil.js', data: utf8('x') }]);
    const error = refusalOf(() => readSafeEntries(tar, 'test'));
    expect(error.code).toBe('unsafe-entry');
    expect(error.message).toContain('path traversal');
  });

  test('refuses a Windows drive-letter path', () => {
    const tar = hostileTar([{ name: 'C:/windows/evil.js', data: utf8('x') }]);
    const error = refusalOf(() => readSafeEntries(tar, 'test'));
    expect(error.code).toBe('unsafe-entry');
    expect(error.message).toContain('absolute path');
  });

  test('a ustar prefix field is rejoined before the path rules run, so it cannot smuggle one past', () => {
    const tar = hostileTar([{ name: 'evil.js', data: utf8('x') }]);
    tar.set(utf8('..'), 345); // the prefix field
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : tar[i]!;
    tar.set(utf8(sum.toString(8).padStart(6, '0')), 148);
    tar[154] = 0;
    tar[155] = 0x20;

    const error = refusalOf(() => readSafeEntries(tar, 'test'));
    expect(error.code).toBe('unsafe-entry');
    expect(error.details.path).toBe('../evil.js');
  });
});
