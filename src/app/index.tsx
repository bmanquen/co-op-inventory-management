import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Inventory, stockKey, useInventory } from '@/inventory';
import { styles as s } from '@/ui';

const STORE_KEY = 'coffee-inventory/store';
// Counts at or below this show as Low.
const LOW = 3;

type Level = 'out' | 'low' | 'ok';
const level = (n: number): Level => (n === 0 ? 'out' : n <= LOW ? 'low' : 'ok');
const tally = (data: Inventory, storeId: number) => {
  const t = { out: 0, low: 0 };
  for (const p of data.products) {
    const l = level(data.stock[stockKey(storeId, p.id)] ?? 0);
    if (l !== 'ok') t[l]++;
  }
  return t;
};

type Undo = { storeId: number; productId: number; name: string; before: number; count: number };

export default function StockScreen() {
  const { data, setCount, adjust } = useInventory();
  const [storeId, setStoreId] = useState(data.stores[0]?.id);
  const store = data.stores.find((st) => st.id === storeId) ?? data.stores[0];
  const [picking, setPicking] = useState(false);
  const [needsOnly, setNeedsOnly] = useState(false);
  const [undo, setUndo] = useState<Undo | null>(null);

  // Reopen on the store this device last counted.
  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY).then((id) => id && setStoreId(Number(id)));
  }, []);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 4000);
    return () => clearTimeout(timer);
  }, [undo]);

  if (!store) return <Text style={s.empty}>Add a store on the Stores tab first.</Text>;

  const pick = (id: number) => {
    setStoreId(id);
    AsyncStorage.setItem(STORE_KEY, String(id));
    setPicking(false);
  };
  const countOf = (productId: number) => data.stock[stockKey(store.id, productId)] ?? 0;
  const { out, low } = tally(data, store.id);
  const products = needsOnly ? data.products.filter((p) => level(countOf(p.id)) !== 'ok') : data.products;

  return (
    <View style={s.screen}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.storeField, pressed && styles.pressed]}
          onPress={() => setPicking(true)}
          accessibilityRole="button"
          accessibilityLabel={`Store: ${store.name}. Change store`}>
          <View style={styles.fill}>
            <Text style={styles.storeLabel}>Counting at</Text>
            <Text style={styles.storeName} numberOfLines={1}>
              {store.name}
            </Text>
          </View>
          <Text style={styles.caret}>⌄</Text>
        </Pressable>
        <View style={styles.chips}>
          <Chip label={`All ${data.products.length}`} selected={!needsOnly} onPress={() => setNeedsOnly(false)} />
          <Chip label={`Needs restock ${out + low}`} selected={needsOnly} onPress={() => setNeedsOnly(true)} />
        </View>
      </View>
      <FlatList
        data={products}
        keyExtractor={(p) => String(p.id)}
        // Room for the undo toast so it never covers the last row.
        contentContainerStyle={{ paddingBottom: 80 }}
        ListEmptyComponent={
          <Text style={s.empty}>{data.products.length ? 'Everything at this store is stocked.' : 'Add a product on the Products tab.'}</Text>
        }
        renderItem={({ item }) => {
          const count = countOf(item.id);
          const l = level(count);
          return (
            <View style={[styles.row, l === 'out' && styles.rowOut]}>
              <View style={styles.fill}>
                <Text style={s.name}>{item.name}</Text>
                {l !== 'ok' && <Badge level={l} label={l === 'out' ? 'Out of stock' : 'Low'} />}
              </View>
              <View style={styles.stepper}>
                <Pressable
                  style={({ pressed }) => [styles.step, pressed && styles.pressed]}
                  onPress={() => adjust(store.id, item.id, -1)}
                  disabled={count === 0}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove one ${item.name}`}>
                  <Text style={[styles.stepText, count === 0 && styles.stepDisabled]}>−</Text>
                </Pressable>
                <CountInput
                  // Remount when the saved count changes so another device's update shows up.
                  key={count}
                  count={count}
                  onSave={(n) => {
                    setCount(store.id, item.id, n);
                    setUndo({ storeId: store.id, productId: item.id, name: item.name, before: count, count: n });
                  }}
                  label={`${item.name} count at ${store.name}`}
                />
                <Pressable
                  style={({ pressed }) => [styles.step, pressed && styles.pressed]}
                  onPress={() => adjust(store.id, item.id, 1)}
                  accessibilityRole="button"
                  accessibilityLabel={`Add one ${item.name}`}>
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
              </View>
            </View>
          );
        }}
      />
      {undo && (
        <View style={styles.toast} accessibilityLiveRegion="polite">
          <Text style={styles.toastText} numberOfLines={2}>
            {undo.name} set to {undo.count}
          </Text>
          <Pressable
            onPress={() => {
              setCount(undo.storeId, undo.productId, undo.before);
              setUndo(null);
            }}
            hitSlop={12}
            accessibilityRole="button">
            <Text style={styles.toastAction}>Undo</Text>
          </Pressable>
        </View>
      )}
      {picking && <StorePicker current={store.id} onPick={pick} onClose={() => setPicking(false)} />}
    </View>
  );
}

function StorePicker({ current, onPick, onClose }: { current: number; onPick: (id: number) => void; onClose: () => void }) {
  const { data } = useInventory();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = data.stores.filter((st) => st.name.toLowerCase().includes(q));

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close store list" />
      <View style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]}>
        <View style={styles.grabber} />
        <Text style={styles.sheetTitle}>Choose a store</Text>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search stores"
          autoFocus
          autoCorrect={false}
          onSubmitEditing={() => matches[0] && onPick(matches[0].id)}
          accessibilityLabel="Search stores"
        />
        <ScrollView keyboardShouldPersistTaps="handled">
          {matches.map((st) => {
            const t = tally(data, st.id);
            const selected = st.id === current;
            return (
              <Pressable
                key={st.id}
                onPress={() => onPick(st.id)}
                style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                accessibilityRole="button"
                accessibilityState={{ selected }}>
                <Text style={styles.check}>{selected ? '✓' : ''}</Text>
                <Text style={[styles.fill, styles.optionText, selected && styles.optionActive]}>{st.name}</Text>
                {t.out > 0 && <Badge level="out" label={`${t.out} out`} />}
                {t.low > 0 && <Badge level="low" label={`${t.low} low`} />}
              </Pressable>
            );
          })}
          {matches.length === 0 && <Text style={styles.noMatch}>No stores match “{query}”</Text>}
        </ScrollView>
      </View>
    </Modal>
  );
}

const Badge = ({ level, label }: { level: 'out' | 'low'; label: string }) => (
  <Text style={[styles.badge, level === 'out' ? styles.badgeOut : styles.badgeLow]}>{label}</Text>
);

const Chip = ({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) => (
  <Pressable
    style={({ pressed }) => [styles.chip, selected && styles.chipOn, pressed && !selected && styles.pressed]}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected }}>
    <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
  </Pressable>
);

// Saves when editing ends, not on every keystroke.
function CountInput({ count, onSave, label }: { count: number; onSave: (n: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(count));
  return (
    <TextInput
      // Grow with the number so the API's 7-digit maximum still fits.
      style={[styles.count, { width: Math.max(52, draft.length * 12 + 16) }]}
      value={draft}
      onChangeText={(t) => setDraft(t.replace(/\D/g, ''))}
      onBlur={() => Number(draft) !== count && onSave(Number(draft))}
      keyboardType="number-pad"
      selectTextOnFocus
      accessibilityLabel={label}
    />
  );
}

const BROWN = '#6f4e37';
const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
  header: { padding: 16, paddingTop: 12, gap: 10, backgroundColor: '#fbf8f5', borderBottomWidth: 1, borderBottomColor: '#ebe3dc' },
  storeField: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ebe3dc', borderRadius: 12 },
  storeLabel: { fontSize: 12, color: '#6b625b' },
  storeName: { fontSize: 17, fontWeight: '700', color: '#1f1a16' },
  caret: { fontSize: 18, color: BROWN },
  chips: { flexDirection: 'row', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#f1e7df' },
  chipOn: { backgroundColor: BROWN },
  chipText: { fontSize: 13, fontWeight: '600', color: '#6b625b' },
  chipTextOn: { color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#ebe3dc' },
  rowOut: { backgroundColor: '#fdf3f1' },
  badge: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, fontSize: 12, fontWeight: '600', overflow: 'hidden' },
  badgeOut: { color: '#b4382b', backgroundColor: '#fbe9e6' },
  badgeLow: { color: '#9a6400', backgroundColor: '#fdf1d8' },
  stepper: { flexDirection: 'row', alignItems: 'center', flexShrink: 0, padding: 2, borderRadius: 12, backgroundColor: '#f8f2ec' },
  step: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 22, color: BROWN },
  stepDisabled: { color: '#c9bdb3' },
  count: { textAlign: 'center', fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'], paddingVertical: 8, borderRadius: 8 },
  toast: { position: 'absolute', left: 16, right: 16, bottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: '#2a231e' },
  toastText: { flex: 1, color: '#fff', fontSize: 14 },
  toastAction: { color: '#f3c79f', fontWeight: '700', fontSize: 14 },
  scrim: { flex: 1, backgroundColor: 'rgba(31,26,22,0.32)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80%', paddingHorizontal: 16, paddingTop: 8, backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: '#d9d1ca', marginBottom: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '700', marginBottom: 12 },
  search: { paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, borderRadius: 10, backgroundColor: '#f8f2ec', marginBottom: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#ebe3dc' },
  optionPressed: { backgroundColor: '#f8f2ec' },
  check: { width: 16, color: BROWN, fontWeight: '700' },
  optionText: { fontSize: 16 },
  optionActive: { color: BROWN, fontWeight: '600' },
  noMatch: { padding: 12, color: '#888' },
});
