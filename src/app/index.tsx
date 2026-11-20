import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { stockKey, useInventory } from '@/inventory';
import { styles as s } from '@/ui';

export default function StockScreen() {
  const { data, setCount, adjust } = useInventory();
  const [storeId, setStoreId] = useState(data.stores[0]?.id);
  const store = data.stores.find((st) => st.id === storeId) ?? data.stores[0];

  if (!store) return <Text style={s.empty}>Add a store on the Stores tab first.</Text>;

  return (
    <View style={s.screen}>
      <View style={styles.chips}>
        {data.stores.map((st) => (
          <Pressable
            key={st.id}
            onPress={() => setStoreId(st.id)}
            style={[styles.chip, st.id === store.id && styles.chipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: st.id === store.id }}>
            <Text style={st.id === store.id ? styles.chipTextActive : undefined}>{st.name}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={data.products}
        keyExtractor={(p) => String(p.id)}
        ListEmptyComponent={<Text style={s.empty}>Add a product on the Products tab.</Text>}
        renderItem={({ item }) => {
          const count = data.stock[stockKey(store.id, item.id)] ?? 0;
          return (
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{item.name}</Text>
                {count === 0 && <Text style={styles.out}>Out of stock</Text>}
              </View>
              <Pressable style={styles.step} onPress={() => adjust(store.id, item.id, -1)} accessibilityLabel={`Remove one ${item.name}`}>
                <Text style={styles.stepText}>−</Text>
              </Pressable>
              <CountInput
                // Remount when the saved count changes so another device's update shows up.
                key={count}
                count={count}
                onSave={(n) => setCount(store.id, item.id, n)}
                label={`${item.name} count at ${store.name}`}
              />
              <Pressable style={styles.step} onPress={() => adjust(store.id, item.id, 1)} accessibilityLabel={`Add one ${item.name}`}>
                <Text style={styles.stepText}>+</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </View>
  );
}

// Saves when editing ends, not on every keystroke.
function CountInput({ count, onSave, label }: { count: number; onSave: (n: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(count));
  return (
    <TextInput
      style={styles.count}
      value={draft}
      onChangeText={(t) => setDraft(t.replace(/\D/g, ''))}
      onBlur={() => Number(draft) !== count && onSave(Number(draft))}
      keyboardType="number-pad"
      selectTextOnFocus
      accessibilityLabel={label}
    />
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  chip: { maxWidth: '100%', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: '#eee' },
  chipActive: { backgroundColor: '#6f4e37' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  out: { color: '#c0392b', fontSize: 12, marginTop: 2 },
  step: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f1e7df', alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 20, color: '#6f4e37' },
  count: { width: 56, textAlign: 'center', fontSize: 16, marginHorizontal: 6, paddingVertical: 6, borderWidth: 1, borderColor: '#ddd', borderRadius: 6 },
});
