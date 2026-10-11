// Главный экран: выбор изображений, превью, отправка и статусы (раздел 7.1 спецификации).

import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { connectionMessage } from './connection.ts';
import { describe } from './status.ts';
import { ActionButton, Banner, colors } from './ui.tsx';
import type { Item, Uploads } from './useUploads.ts';

const TONE_COLORS = { neutral: colors.muted, progress: colors.muted, success: colors.success, error: colors.error };

function Tile(props: { item: Item; onRemove: () => void; onRetry: () => void }) {
  const view = describe(props.item.state);
  return (
    <View style={styles.tile}>
      <View>
        <Image source={{ uri: props.item.uri }} style={styles.preview} />
        {view.tone === 'progress' && (
          <View style={styles.overlay}>
            <ActivityIndicator color="#fff" />
          </View>
        )}
        {view.canRemove && (
          <Pressable style={styles.remove} onPress={props.onRemove} hitSlop={8} accessibilityLabel="Удалить из списка">
            <Text style={styles.removeText}>✕</Text>
          </Pressable>
        )}
      </View>
      {view.label !== '' && <Text style={[styles.status, { color: TONE_COLORS[view.tone] }]}>{view.label}</Text>}
      {view.canRetry && (
        <Pressable onPress={props.onRetry} hitSlop={6}>
          <Text style={styles.retry}>Повторить</Text>
        </Pressable>
      )}
    </View>
  );
}

export function MainScreen(props: { uploads: Uploads; onOpenSettings: () => void }) {
  const { uploads } = props;
  const { items, connection } = uploads;

  // Системный picker работает без доступа к галерее, поэтому разрешение не запрашивается.
  // Режим Compatible на iOS отдаёт фото в HEIC как JPEG.
  const pick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 0,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (!result.canceled) uploads.add(result.assets);
  };

  const views = items.map((item) => describe(item.state));
  const selected = items.filter((item) => item.state.kind === 'selected').length;
  const inserted = items.filter((item) => item.state.kind === 'job' && item.state.status === 'inserted').length;
  const retryable = views.filter((view) => view.canRetry).length;
  const allInserted = items.length > 0 && inserted === items.length;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Mobile Gallery</Text>
        <Pressable onPress={props.onOpenSettings} hitSlop={8}>
          <Text style={styles.link}>Настройки</Text>
        </Pressable>
      </View>

      {connection === 'no_plugin' && <Banner tone="warning" text={connectionMessage(connection)} />}
      {connection === 'offline' && (
        <Banner tone="error" text={connectionMessage(connection)} action={{ title: 'Как подключиться', onPress: props.onOpenSettings }} />
      )}
      {(connection === 'foreign' || connection === 'bad_token') && (
        <Banner tone="error" text={connectionMessage(connection)} action={{ title: 'Открыть настройки', onPress: props.onOpenSettings }} />
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={3}
        style={styles.list}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>Выберите изображения, чтобы отправить их на текущую страницу Figma.</Text>}
        renderItem={({ item }) => (
          <Tile item={item} onRemove={() => uploads.remove(item.id)} onRetry={() => uploads.retry(item.id)} />
        )}
      />

      <View style={styles.footer}>
        {items.length > 0 && (
          <Text style={styles.summary}>
            {allInserted ? `Вставлено ${inserted}` : `Вставлено ${inserted} из ${items.length}`}
          </Text>
        )}
        {retryable > 1 && <ActionButton secondary title={`Повторить все с ошибкой (${retryable})`} onPress={uploads.retryAll} />}
        {allInserted ? (
          <ActionButton secondary title="Очистить список" onPress={uploads.clear} />
        ) : (
          <ActionButton secondary title={items.length > 0 ? 'Добавить ещё' : 'Выбрать изображения'} onPress={pick} />
        )}
        {allInserted ? (
          <ActionButton title="Выбрать изображения" onPress={pick} />
        ) : (
          <ActionButton
            title={selected > 0 ? `Отправить в Figma (${selected})` : 'Отправить в Figma'}
            onPress={uploads.send}
            disabled={selected === 0 || uploads.sending}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  link: { color: colors.accent, fontSize: 16 },
  list: { flex: 1 },
  listContent: { gap: 12, paddingBottom: 12, flexGrow: 1 },
  row: { gap: 8 },
  empty: { color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: 'center', marginTop: 80, paddingHorizontal: 24 },
  tile: { flex: 1 / 3, gap: 4 },
  preview: { width: '100%', aspectRatio: 1, borderRadius: 8, backgroundColor: colors.surface },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  remove: { position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  removeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  status: { fontSize: 12, lineHeight: 15 },
  retry: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  footer: { gap: 8, paddingBottom: 8 },
  summary: { color: colors.muted, fontSize: 13, textAlign: 'center' },
});
