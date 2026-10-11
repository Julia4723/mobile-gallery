import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { Settings } from './src/api.ts';
import { MainScreen } from './src/MainScreen.tsx';
import { loadSettings, saveSettings } from './src/settings.ts';
import { SettingsScreen } from './src/SettingsScreen.tsx';
import { ActionButton, colors } from './src/ui.tsx';
import { useUploads } from './src/useUploads.ts';

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  const save = (next: Settings) => {
    setSettings(next);
    setSettingsOpen(false);
    void saveSettings(next);
  };

  const configured = settings !== null && settings.serverUrl !== '' && settings.token !== '';
  // Список изображений живёт здесь, а не в главном экране: открытие настроек не должно его сбрасывать.
  const uploads = useUploads(configured ? settings : null);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        {settings === null ? null : settingsOpen ? (
          <SettingsScreen initial={settings} onSave={save} onClose={() => setSettingsOpen(false)} />
        ) : configured ? (
          <MainScreen uploads={uploads} onOpenSettings={() => setSettingsOpen(true)} />
        ) : (
          <View style={styles.setup}>
            <Text style={styles.title}>Mobile Gallery</Text>
            <Text style={styles.text}>Подключение не настроено. Укажите адрес сервера и токен.</Text>
            <ActionButton title="Открыть настройки" onPress={() => setSettingsOpen(true)} />
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  setup: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 16 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, textAlign: 'center' },
  text: { fontSize: 15, lineHeight: 21, color: colors.muted, textAlign: 'center' },
});
