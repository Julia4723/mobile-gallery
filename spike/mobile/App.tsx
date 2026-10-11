// ОДНОРАЗОВЫЙ КОД ЭКСПЕРИМЕНТА. В продукт не переносится.
import { useState } from 'react';
import { Button, Image, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';

type Asset = ImagePicker.ImagePickerAsset;

async function request(url: string, init?: RequestInit): Promise<string> {
  const started = Date.now();
  try {
    const response = await fetch(url, init);
    return `HTTP ${response.status} ${await response.text()} (${Date.now() - started} мс)`;
  } catch (error) {
    return `ошибка: ${String(error)} (${Date.now() - started} мс)`;
  }
}

export default function App() {
  const [server, setServer] = useState(process.env.EXPO_PUBLIC_SERVER_URL ?? '');
  const [token, setToken] = useState(process.env.EXPO_PUBLIC_TOKEN ?? '');
  const [asset, setAsset] = useState<Asset | null>(null);
  const [mode, setMode] = useState('');
  const [log, setLog] = useState<string[]>([]);

  const base = server.trim().replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${token.trim()}` };
  const add = (line: string) => setLog((lines) => [...lines, line]);

  const check = async () => {
    add(`[связь] ${Platform.OS} ${Platform.Version} → ${base}`);
    add(`  health: ${await request(`${base}/health`)}`);
    add(`  с токеном: ${await request(`${base}/auth-check`, { headers })}`);
  };

  // Разрешение на галерею не запрашиваем: системный picker работает без него.
  const pick = async (label: string, options: ImagePicker.ImagePickerOptions) => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], ...options });
    if (result.canceled) return add(`[выбор: ${label}] отменён`);
    const picked = result.assets[0];
    setAsset(picked);
    setMode(label);
    add(`[выбор: ${label}] ${picked.fileName} · ${picked.mimeType} · ${picked.width}×${picked.height} · ${picked.fileSize} байт`);
    add(`  uri: …${picked.uri.slice(-40)}`);
  };

  const upload = async () => {
    if (!asset) return;
    // fetch(uri).blob() на Android прислал серверу не содержимое файла, поэтому читаем байты явно.
    const started = Date.now();
    try {
      const bytes = await new File(asset.uri).bytes();
      const response = await expoFetch(`${base}/upload`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': asset.mimeType ?? 'application/octet-stream' },
        body: bytes,
      });
      add(`[отправка: ${mode}] прочитано ${bytes.length} байт → HTTP ${response.status} ${await response.text()} (${Date.now() - started} мс)`);
    } catch (error) {
      add(`[отправка: ${mode}] ошибка: ${String(error)}`);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Адрес сервера</Text>
      <TextInput
        style={styles.input}
        value={server}
        onChangeText={setServer}
        placeholder="http://192.168.1.10:8787"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Text style={styles.label}>Токен</Text>
      <TextInput style={styles.input} value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} secureTextEntry />

      <View style={styles.gap}><Button title="1. Проверить связь" onPress={check} /></View>
      <View style={styles.gap}><Button title="2а. Выбрать (по умолчанию)" onPress={() => pick('по умолчанию', {})} /></View>
      <View style={styles.gap}>
        <Button
          title="2б. Выбрать (Compatible)"
          onPress={() =>
            pick('Compatible', {
              preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
            })
          }
        />
      </View>

      {asset && <Image source={{ uri: asset.uri }} style={styles.preview} resizeMode="contain" />}
      <View style={styles.gap}><Button title="3. Отправить выбранное" onPress={upload} disabled={!asset} /></View>

      <Text style={styles.label}>Журнал (нажмите и удерживайте, чтобы скопировать)</Text>
      <Text selectable style={styles.log}>{log.join('\n')}</Text>
      <View style={styles.gap}><Button title="Очистить журнал" onPress={() => setLog([])} /></View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, paddingTop: 64, paddingBottom: 48 },
  label: { fontSize: 12, color: '#555', marginTop: 12, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#bbb', borderRadius: 6, padding: 8, fontSize: 14 },
  gap: { marginTop: 10 },
  preview: { width: '100%', height: 180, marginTop: 12, backgroundColor: '#f3f3f3' },
  log: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11, backgroundColor: '#f3f3f3', padding: 8 },
});
