const ip = exports;
const { Buffer } = require('buffer');
const os = require('os');

ip.toBuffer = function (ip, buff, offset) {
  offset = ~~offset;

  let result;

  if (this.isV4Format(ip)) {
    result = buff || Buffer.alloc(offset + 4);
    ip.split(/\./g).map((byte) => {
      result[offset++] = parseInt(byte, 10) & 0xff;
    });
  } else if (this.isV6Format(ip)) {
    const sections = ip.split(':', 8);

    let i;
    for (i = 0; i < sections.length; i++) {
      const isv4 = this.isV4Format(sections[i]);
      let v4Buffer;

      if (isv4) {
        v4Buffer = this.toBuffer(sections[i]);
        sections[i] = v4Buffer.slice(0, 2).toString('hex');
      }

      if (v4Buffer && ++i < 8) {
        sections.splice(i, 0, v4Buffer.slice(2, 4).toString('hex'));
      }
    }

    if (sections[0] === '') {
      while (sections.length < 8) sections.unshift('0');
    } else if (sections[sections.length - 1] === '') {
      while (sections.length < 8) sections.push('0');
    } else if (sections.length < 8) {
      for (i = 0; i < sections.length && sections[i] !== ''; i++);
      const argv = [i, 1];
      for (i = 9 - sections.length; i > 0; i--) {
        argv.push('0');
      }
      sections.splice(...argv);
    }

    result = buff || Buffer.alloc(offset + 16);
    for (i = 0; i < sections.length; i++) {
      const word = parseInt(sections[i], 16);
      result[offset++] = (word >> 8) & 0xff;
      result[offset++] = word & 0xff;
    }
  }

  if (!result) {
    throw Error(`Invalid ip address: ${ip}`);
  }

  return result;
};

ip.toString = function (buff, offset, length) {
  offset = ~~offset;
  length = length || (buff.length - offset);

  let result = [];
  if (length === 4) {
    // IPv4
    for (let i = 0; i < length; i++) {
      result.push(buff[offset + i]);
    }
    result = result.join('.');
  } else if (length === 16) {
    // IPv6
    for (let i = 0; i < length; i += 2) {
      result.push(buff.readUInt16BE(offset + i).toString(16));
    }
    result = result.join(':');
    result = result.replace(/(^|:)0(:0)*:0(:|$)/, '$1::$3');
    result = result.replace(/:{3,4}/, '::');
  }

  return result;
};

const ipv4Regex = /^(\d{1,3}\.){3,3}\d{1,3}$/;
const ipv6Regex = /^(::)?(((\d{1,3}\.){3}(\d{1,3}){1})?([0-9a-f]){0,4}:{0,2}){1,8}(::)?$/i;

ip.isV4Format = function (ip) {
  return ipv4Regex.test(ip);
};

ip.isV6Format = function (ip) {
  return ipv6Regex.test(ip);
};

function _normalizeFamily(family) {
  if (family === 4) {
    return 'ipv4';
  }
  if (family === 6) {
    return 'ipv6';
  }
  return family ? family.toLowerCase() : 'ipv4';
}

ip.fromPrefixLen = function (prefixlen, family) {
  if (prefixlen > 32) {
    family = 'ipv6';
  } else {
    family = _normalizeFamily(family);
  }

  let len = 4;
  if (family === 'ipv6') {
    len = 16;
  }
  const buff = Buffer.alloc(len);

  for (let i = 0, n = buff.length; i < n; ++i) {
    let bits = 8;
    if (prefixlen < 8) {
      bits = prefixlen;
    }
    prefixlen -= bits;

    buff[i] = ~(0xff >> bits) & 0xff;
  }

  return ip.toString(buff);
};

ip.mask = function (addr, mask) {
  addr = ip.toBuffer(addr);
  mask = ip.toBuffer(mask);

  const result = Buffer.alloc(Math.max(addr.length, mask.length));

  // Same protocol - do bitwise and
  let i;
  if (addr.length === mask.length) {
    for (i = 0; i < addr.length; i++) {
      result[i] = addr[i] & mask[i];
    }
  } else if (mask.length === 4) {
    // IPv6 address and IPv4 mask
    // (Mask low bits)
    for (i = 0; i < mask.length; i++) {
      result[i] = addr[addr.length - 4 + i] & mask[i];
    }
  } else {
    // IPv6 mask and IPv4 addr
    for (i = 0; i < result.length - 6; i++) {
      result[i] = 0;
    }

    // ::ffff:ipv4
    result[10] = 0xff;
    result[11] = 0xff;
    for (i = 0; i < addr.length; i++) {
      result[i + 12] = addr[i] & mask[i + 12];
    }
    i += 12;
  }
  for (; i < result.length; i++) {
    result[i] = 0;
  }

  return ip.toString(result);
};

ip.cidr = function (cidrString) {
  const cidrParts = cidrString.split('/');

  const addr = cidrParts[0];
  if (cidrParts.length !== 2) {
    throw new Error(`invalid CIDR subnet: ${addr}`);
  }

  const mask = ip.fromPrefixLen(parseInt(cidrParts[1], 10));

  return ip.mask(addr, mask);
};

ip.subnet = function (addr, mask) {
  const networkAddress = ip.toLong(ip.mask(addr, mask));

  // Calculate the mask's length.
  const maskBuffer = ip.toBuffer(mask);
  let maskLength = 0;

  for (let i = 0; i < maskBuffer.length; i++) {
    if (maskBuffer[i] === 0xff) {
      maskLength += 8;
    } else {
      let octet = maskBuffer[i] & 0xff;
      while (octet) {
        octet = (octet << 1) & 0xff;
        maskLength++;
      }
    }
  }

  const numberOfAddresses = 2 ** (32 - maskLength);

  return {
    networkAddress: ip.fromLong(networkAddress),
    firstAddress: numberOfAddresses <= 2
      ? ip.fromLong(networkAddress)
      : ip.fromLong(networkAddress + 1),
    lastAddress: numberOfAddresses <= 2
      ? ip.fromLong(networkAddress + numberOfAddresses - 1)
      : ip.fromLong(networkAddress + numberOfAddresses - 2),
    broadcastAddress: ip.fromLong(networkAddress + numberOfAddresses - 1),
    subnetMask: mask,
    subnetMaskLength: maskLength,
    numHosts: numberOfAddresses <= 2
      ? numberOfAddresses : numberOfAddresses - 2,
    length: numberOfAddresses,
    contains(other) {
      return networkAddress === ip.toLong(ip.mask(other, mask));
    },
  };
};

ip.cidrSubnet = function (cidrString) {
  const cidrParts = cidrString.split('/');

  const addr = cidrParts[0];
  if (cidrParts.length !== 2) {
    throw new Error(`invalid CIDR subnet: ${addr}`);
  }

  const mask = ip.fromPrefixLen(parseInt(cidrParts[1], 10));

  return ip.subnet(addr, mask);
};

ip.not = function (addr) {
  const buff = ip.toBuffer(addr);
  for (let i = 0; i < buff.length; i++) {
    buff[i] = 0xff ^ buff[i];
  }
  return ip.toString(buff);
};

ip.or = function (a, b) {
  a = ip.toBuffer(a);
  b = ip.toBuffer(b);

  // same protocol
  if (a.length === b.length) {
    for (let i = 0; i < a.length; ++i) {
      a[i] |= b[i];
    }
    return ip.toString(a);

  // mixed protocols
  }
  let buff = a;
  let other = b;
  if (b.length > a.length) {
    buff = b;
    other = a;
  }

  const offset = buff.length - other.length;
  for (let i = offset; i < buff.length; ++i) {
    buff[i] |= other[i - offset];
  }

  return ip.toString(buff);
};

ip.isEqual = function (a, b) {
  a = ip.toBuffer(a);
  b = ip.toBuffer(b);

  // Same protocol
  if (a.length === b.length) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // Swap
  if (b.length === 4) {
    const t = b;
    b = a;
    a = t;
  }

  // a - IPv4, b - IPv6
  for (let i = 0; i < 10; i++) {
    if (b[i] !== 0) return false;
  }

  const word = b.readUInt16BE(10);
  if (word !== 0 && word !== 0xffff) return false;

  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i + 12]) return false;
  }

  return true;
};

ip.isPrivate = function (addr) {
  // check loopback addresses first
  if (ip.isLoopback(addr)) {
    return true;
  }

  // ensure the ipv4 address is valid
  if (!ip.isV6Format(addr)) {
    const ipl = ip.normalizeToLong(addr);
    if (ipl < 0) {
      throw new Error('invalid ipv4 address');
    }
    // normalize the address for the private range checks that follow
    addr = ip.fromLong(ipl);
  }

  // check private ranges
  return /^(::f{4}:)?10\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(addr)
    || /^(::f{4}:)?192\.168\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(addr)
    || /^(::f{4}:)?172\.(1[6-9]|2\d|30|31)\.([0-9]{1,3})\.([0-9]{1,3})$/i
      .test(addr)
    || /^(::f{4}:)?169\.254\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(addr)
    || /^f[cd][0-9a-f]{2}:/i.test(addr)
    || /^fe80:/i.test(addr)
    || /^::1$/.test(addr)
    || /^::$/.test(addr);
};

ip.isPublic = function (addr) {
  const privateRanges = [
    ['10.0.0.0', '10.255.255.255'],
    ['172.16.0.0', '172.31.255.255'],
    ['192.168.0.0', '192.168.255.255'],
    ['127.0.0.0', '127.255.255.255'],
    ['169.254.0.0', '169.254.255.255'],
    ['::1', '::1'],
    ['fc00::', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'],
    ['fe80::', 'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff'],
  ];

  const long = ip.toLong(addr);
  const isIPv6 = addr.includes(':');

  return !privateRanges.some(([start, end]) => {
    if (isIPv6 !== start.includes(':')) return false;
    const s = isIPv6 ? ip.toBuffer(start) : ip.toLong(start);
    const e = isIPv6 ? ip.toBuffer(end) : ip.toLong(end);
    const a = isIPv6 ? ip.toBuffer(addr) : long;
    return a >= s && a <= e;
  });
};


ip.isLoopback = function (addr) {
  // If addr is an IPv4 address in long integer form (no dots and no colons), convert it
  if (!/\./.test(addr) && !/:/.test(addr)) {
    addr = ip.fromLong(Number(addr));
  }

  return /^(::f{4}:)?127\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/
    .test(addr)
    || /^0177\./.test(addr)
    || /^0x7f\./i.test(addr)
    || /^fe80::1$/i.test(addr)
    || /^::1$/.test(addr)
    || /^::$/.test(addr);
};

ip.loopback = function (family) {
  //
  // Default to `ipv4`
  //
  family = _normalizeFamily(family);

  if (family !== 'ipv4' && family !== 'ipv6') {
    throw new Error('family must be ipv4 or ipv6');
  }

  return family === 'ipv4' ? '127.0.0.1' : 'fe80::1';
};

//
// ### function address (name, family)
// #### @name {string|'public'|'private'} **Optional** Name or security
//      of the network interface.
// #### @family {ipv4|ipv6} **Optional** IP family of the address (defaults
//      to ipv4).
//
// Returns the address for the network interface on the current system with
// the specified `name`:
//   * String: First `family` address of the interface.
//             If not found see `undefined`.
//   * 'public': the first public ip address of family.
//   * 'private': the first private ip address of family.
//   * undefined: First address with `ipv4` or loopback address `127.0.0.1`.
//
ip.address = function (name, family) {
  const interfaces = os.networkInterfaces();

  //
  // Default to `ipv4`
  //
  family = _normalizeFamily(family);

  //
  // If a specific network interface has been named,
  // return the address.
  //
  if (name && name !== 'private' && name !== 'public') {
    const res = interfaces[name].filter((details) => {
      const itemFamily = _normalizeFamily(details.family);
      return itemFamily === family;
    });
    if (res.length === 0) {
      return undefined;
    }
    return res[0].address;
  }

  const all = Object.keys(interfaces).map((nic) => {
    //
    // Note: name will only be `public` or `private`
    // when this is called.
    //
    const addresses = interfaces[nic].filter((details) => {
      details.family = _normalizeFamily(details.family);
      if (details.family !== family || ip.isLoopback(details.address)) {
        return false;
      } if (!name) {
        return true;
      }

      return name === 'public' ? ip.isPrivate(details.address)
        : ip.isPublic(details.address);
    });

    return addresses.length ? addresses[0].address : undefined;
  }).filter(Boolean);

  return !all.length ? ip.loopback(family) : all[0];
};

ip.toLong = function (ip) {
  let ipl = 0;
  ip.split('.').forEach((octet) => {
    ipl <<= 8;
    ipl += parseInt(octet);
  });
  return (ipl >>> 0);
};

ip.fromLong = function (ipl) {
  return (`${ipl >>> 24}.${
    ipl >> 16 & 255}.${
    ipl >> 8 & 255}.${
    ipl & 255}`);
};

ip.normalizeToLong = function (addr) {
  const parts = addr.split('.').map(part => {
    // Handle hexadecimal format
    if (part.startsWith('0x') || part.startsWith('0X')) {
      return parseInt(part, 16);
    }
    // Handle octal format (strictly digits 0-7 after a leading zero)
    else if (part.startsWith('0') && part !== '0' && /^[0-7]+$/.test(part)) {
      return parseInt(part, 8);
    }
    // Handle decimal format, reject invalid leading zeros
    else if (/^[1-9]\d*$/.test(part) || part === '0') {
      return parseInt(part, 10);
    }
    // Return NaN for invalid formats to indicate parsing failure
    else {
      return NaN;
    }
  });

  if (parts.some(isNaN)) return -1; // Indicate error with -1

  let val = 0;
  const n = parts.length;

  switch (n) {
  case 1:
    val = parts[0];
    break;
  case 2:
    if (parts[0] > 0xff || parts[1] > 0xffffff) return -1;
    val = (parts[0] << 24) | (parts[1] & 0xffffff);
    break;
  case 3:
    if (parts[0] > 0xff || parts[1] > 0xff || parts[2] > 0xffff) return -1;
    val = (parts[0] << 24) | (parts[1] << 16) | (parts[2] & 0xffff);
    break;
  case 4:
    if (parts.some(part => part > 0xff)) return -1;
    val = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
    break;
  default:
    return -1; // Error case
  }

  return val >>> 0;
};
