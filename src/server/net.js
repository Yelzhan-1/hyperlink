/**
 * Network helpers — finding the address the *other* laptop must type in.
 */

import { networkInterfaces } from 'node:os';

/**
 * Every non-internal IPv4 address on this machine, most-likely-LAN first.
 * @returns {{name: string, address: string}[]}
 */
export function lanAddresses() {
  /** @type {{name: string, address: string}[]} */
  const found = [];
  const interfaces = networkInterfaces();
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const addr of addresses ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      found.push({ name, address: addr.address });
    }
  }
  // en0/wlan0-style interfaces before virtual bridges (docker, utun, vmnet).
  const rank = (/** @type {{name: string}} */ i) => {
    if (/^(en|wl|eth)/i.test(i.name)) return 0;
    if (/(docker|br-|veth|utun|vmnet|bridge|tun|tap)/i.test(i.name)) return 2;
    return 1;
  };
  return found.sort((a, b) => rank(a) - rank(b));
}

/**
 * @returns {string | null} the address to print as "Network:"
 */
export function primaryLanAddress() {
  const [first] = lanAddresses();
  return first ? first.address : null;
}
