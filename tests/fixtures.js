// Generated from literate/75-tests-services.md by opensheaf-literate: edit the document, not this file.
import zlib from 'node:zlib';

export function tarGz(members) {
  const blocks = [];
  for (const [name, text, type = '0'] of members) {
    const data = typeof text === 'string' ? new TextEncoder().encode(text) : text;
    const h = new Uint8Array(512);
    const put = (at, s) => h.set(new TextEncoder().encode(s), at);
    put(0, name);
    put(100, '0000644\0');
    put(108, '0000000\0');
    put(116, '0000000\0');
    put(124, data.length.toString(8).padStart(11, '0') + '\0');
    put(136, '00000000000\0');
    put(148, '        ');
    h[156] = type.charCodeAt(0);
    put(257, 'ustar\x0000');
    const sum = h.reduce((n, b) => n + b, 0);
    put(148, sum.toString(8).padStart(6, '0') + '\0 ');
    blocks.push(h, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  return new Uint8Array(zlib.gzipSync(Buffer.concat(blocks)));
}
