// Config plugin: точечное разрешение HTTP на Android для сервера в локальной сети.
//
// Начиная с Android 9 HTTP без шифрования запрещён по умолчанию. Плагин не снимает запрет глобально
// (android:usesCleartextTraffic не используется), а добавляет сетевую политику с исключениями:
//   - имена *.local — компьютер в той же сети Wi-Fi, например http://my-mac.local:8787;
//   - адреса из параметра hosts — запасной вариант для устройств, где имена .local не разрешаются.
//
// Когда в приложении есть сетевая политика, Android игнорирует флаг usesCleartextTraffic из debug-манифеста.
// Поэтому для debug-вариантов плагин кладёт отдельную политику, разрешающую HTTP: без неё development build
// не подключится к dev-серверу. В release-сборку она не попадает.

const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const RESOURCE = 'network_security_config';
const DEBUG_VARIANTS = ['debug', 'debugOptimized'];

function releasePolicy(hosts) {
  const extra = hosts.map((host) => `    <domain includeSubdomains="false">${host}</domain>`);
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<network-security-config>',
    '  <domain-config cleartextTrafficPermitted="true">',
    '    <domain includeSubdomains="true">local</domain>',
    ...extra,
    '  </domain-config>',
    '</network-security-config>',
    '',
  ].join('\n');
}

const DEBUG_POLICY = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<network-security-config>',
  '  <base-config cleartextTrafficPermitted="true" />',
  '</network-security-config>',
  '',
].join('\n');

function writePolicy(projectRoot, variant, content) {
  const directory = path.join(projectRoot, 'app', 'src', variant, 'res', 'xml');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${RESOURCE}.xml`), content);
}

module.exports = function withLocalCleartext(config, { hosts = [] } = {}) {
  for (const host of hosts) {
    if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new Error(`withLocalCleartext: недопустимый адрес "${host}"`);
  }

  config = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$['android:networkSecurityConfig'] = `@xml/${RESOURCE}`;
    return mod;
  });

  return withDangerousMod(config, [
    'android',
    (mod) => {
      const root = mod.modRequest.platformProjectRoot;
      writePolicy(root, 'main', releasePolicy(hosts));
      for (const variant of DEBUG_VARIANTS) writePolicy(root, variant, DEBUG_POLICY);
      return mod;
    },
  ]);
};
