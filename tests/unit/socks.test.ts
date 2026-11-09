import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { socks5Connect } from '../../src/core/quality/socks';
import { publicIp } from '../../src/core/quality/quality';

// A tiny SOCKS5 server that records the CONNECT target, then echoes bytes back.
function fakeSocks(reply = 0x00): Promise<{ port: number; target: () => string; close: () => Promise<void> }> {
  let target = '';
  const srv = net.createServer((s) => {
    let stage = 0;
    s.on('data', (d) => {
      if (stage === 0) { s.write(Buffer.from([0x05, 0x00])); stage = 1; return; }
      if (stage === 1) {
        const len = d[4];
        target = `${d.subarray(5, 5 + len).toString()}:${d.readUInt16BE(5 + len)}`;
        // reply with a domain-type bound address to exercise the variable-length header
        s.write(Buffer.concat([Buffer.from([0x05, reply, 0x00, 0x03, 3]), Buffer.from('abc'), Buffer.from([0, 80])]));
        stage = 2;
        if (reply !== 0x00) s.end();
        return;
      }
      s.write(d);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({
    port: (srv.address() as net.AddressInfo).port,
    target: () => target,
    close: () => new Promise((c) => srv.close(() => c())),
  })));
}

describe('socks5Connect', () => {
  it('sends the host as a domain (remote DNS) and hands over a clean stream', async () => {
    const f = await fakeSocks();
    const sock = await socks5Connect(`127.0.0.1:${f.port}`, 'api.ipify.org', 443, 3000);
    expect(f.target()).toBe('api.ipify.org:443');
    const got = await new Promise<string>((r) => { let acc = ''; sock.on('data', (d) => { acc += d.toString(); if (acc.length >= 2) r(acc); }); sock.write('xy'); });
    expect(got).toBe('xy'); // the stream after the handshake is the target's
    sock.destroy();
    await f.close();
  });

  it('rejects when the proxy cannot reach the target', async () => {
    const f = await fakeSocks(0x05);
    await expect(socks5Connect(`127.0.0.1:${f.port}`, 'example.org', 443, 3000)).rejects.toThrow(/reply 5/);
    await f.close();
  });

  it('publicIp through a dead SOCKS endpoint errors instead of going direct', async () => {
    const r = await publicIp(2000, '127.0.0.1:1');
    expect('error' in r).toBe(true);
  });

  it('rejects a dead endpoint', async () => {
    await expect(socks5Connect('127.0.0.1:1', 'example.org', 443, 2000)).rejects.toThrow(/SOCKS 127.0.0.1:1/);
  });
});
