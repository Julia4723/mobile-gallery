// Экран настроек: адрес сервера, токен, проверка соединения и подсказка (разделы 7.1 и 9.4 спецификации).

import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { checkHealth, type Settings } from './api.ts';
import { connectionMessage, normalizeServerUrl, type Connection } from './connection.ts';
import { ActionButton, colors } from './ui.tsx';

const HELP = [
  'Сервер запущен на компьютере, в его окне напечатан адрес для телефона.',
  'Адрес здесь совпадает с напечатанным, начинается с http:// и заканчивается на :8787.',
  'Телефон подключён к той же сети Wi-Fi, что и компьютер. Гостевая сеть не подходит.',
  'VPN на телефоне выключен.',
  'На iPhone приложению разрешён доступ к локальной сети: «Настройки → Конфиденциальность и безопасность → Локальная сеть».',
  'Если на компьютере включён firewall, входящие подключения для сервера разрешены.',
];

export function SettingsScreen(props: { initial: Settings; onSave: (settings: Settings) => void; onClose?: () => void }) {
  const [serverUrl, setServerUrl] = useState(props.initial.serverUrl);
  const [token, setToken] = useState(props.initial.token);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Connection | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const current = (): Settings => ({ serverUrl: normalizeServerUrl(serverUrl), token: token.trim() });
  const filled = serverUrl.trim() !== '' && token.trim() !== '';

  const check = async () => {
    setChecking(true);
    setResult(null);
    const connection = await checkHealth(current());
    setResult(connection);
    if (connection === 'offline') setHelpOpen(true);
    setChecking(false);
  };

  const good = result === 'ready' || result === 'no_plugin';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={styles.title}>Настройки</Text>
        {props.onClose && (
          <Pressable onPress={props.onClose} hitSlop={8}>
            <Text style={styles.link}>Отмена</Text>
          </Pressable>
        )}
      </View>

      <View>
        <Text style={styles.label}>Адрес сервера</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="http://192.168.1.10:8787"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Text style={styles.hint}>Сервер печатает этот адрес при запуске, строка «Для телефона».</Text>
      </View>

      <View>
        <Text style={styles.label}>Токен</Text>
        <TextInput
          style={styles.input}
          value={token}
          onChangeText={setToken}
          placeholder="из файла server/.token"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
      </View>

      <ActionButton secondary title="Проверить соединение" onPress={check} disabled={!filled || checking} />
      {checking && <ActivityIndicator />}
      {result && (
        <Text style={[styles.result, { color: good ? colors.success : colors.error }]}>
          {result === 'no_plugin' ? `Сервер доступен, токен верный. ${connectionMessage(result)}` : connectionMessage(result)}
        </Text>
      )}

      <ActionButton title="Сохранить" onPress={() => props.onSave(current())} disabled={!filled} />

      <Pressable onPress={() => setHelpOpen(!helpOpen)} hitSlop={8}>
        <Text style={styles.link}>{helpOpen ? 'Скрыть подсказку' : 'Как подключиться'}</Text>
      </Pressable>
      {helpOpen && (
        <View style={styles.help}>
          {HELP.map((line, index) => (
            <Text key={index} style={styles.helpLine}>
              {index + 1}. {line}
            </Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  link: { color: colors.accent, fontSize: 16 },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 16, color: colors.text },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6 },
  result: { fontSize: 14, lineHeight: 19 },
  help: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, gap: 8 },
  helpLine: { fontSize: 14, lineHeight: 19, color: colors.text },
});
