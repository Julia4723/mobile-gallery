// Выбор адреса для телефона по имени сетевого интерфейса (раздел 9.1 спецификации).

import os from 'node:os';

export type InterfaceAddress = { name: string; address: string };

// IPv4-адреса всех внешних интерфейсов этого компьютера.
export function listAddresses(interfaces = os.networkInterfaces()): InterfaceAddress[] {
  const result: InterfaceAddress[] = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const item of addresses ?? []) {
      if (item.family === 'IPv4' && !item.internal) result.push({ name, address: item.address });
    }
  }
  return result;
}

export function resolveLanAddress(name: string, interfaces = os.networkInterfaces()): string | null {
  return listAddresses(interfaces).find((item) => item.name === name)?.address ?? null;
}
