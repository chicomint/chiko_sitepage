import { BlockList, isIP } from 'node:net';

export function normalizeIp(value) {
  if (typeof value !== 'string' || !isIP(value.trim())) return null;
  value = value.trim();
  if (isIP(value) === 4) return value;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  if (canonical.startsWith('::ffff:')) {
    const parts = canonical.slice(7).split(':');
    if (parts.length === 2) {
      const number = parseInt(parts[0], 16) * 65536 + parseInt(parts[1], 16);
      return [24, 16, 8, 0].map(shift => (number >>> shift) & 255).join('.');
    }
  }
  return canonical;
}

export function clientIpResolver({ trustedProxies = [], header = 'x-forwarded-for' } = {}) {
  if (!['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip'].includes(header)) throw new Error('Invalid stats IP header');
  const trusted = new BlockList();
  for (const entry of trustedProxies) {
    const [address, prefix, extra] = entry.split('/');
    const ip = normalizeIp(address);
    if (!ip || extra !== undefined) throw new Error('Invalid trusted proxy');
    const family = isIP(ip) === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) trusted.addAddress(ip, family);
    else {
      if (!/^\d+$/.test(prefix)) throw new Error('Invalid proxy CIDR');
      trusted.addSubnet(ip, Number(prefix), family);
    }
  }
  const isTrusted = ip => trusted.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6');
  return req => {
    const peer = normalizeIp(req.socket.remoteAddress);
    if (!peer || !isTrusted(peer)) return peer;
    const raw = req.headers[header];
    // A missing/invalid required header must not merge everyone into the proxy IP.
    if (typeof raw !== 'string') return null;
    if (header !== 'x-forwarded-for') return normalizeIp(raw);
    const chain = raw.split(',').map(normalizeIp);
    if (!chain.length || chain.some(ip => !ip)) return null;
    let ip = peer;
    for (let i = chain.length - 1; i >= 0 && isTrusted(ip); i--) ip = chain[i];
    return ip;
  };
}
