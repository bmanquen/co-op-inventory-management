import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { stockKey, useInventory } from '@/inventory';
import { styles as s } from '@/ui';

export default function StockScreen() {
  const { data, setCount, adjust } = useInventory();
  const [storeId, setStoreId] = useState(data.stores[0]?.id);
  const store = data.stores.find((st) => st.id === storeId) ?? data.stores[0];

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = data.stores.filter((st) => st.name.toLowerCase().includes(q));
  const pick = (id: number) => {
    setStoreId(id);
    setOpen(false);
  };

  if (!store) return <Text style={s.empty}>Add a store on the Stores tab first.</Text>;

  return (
    <View style={s.screen}>
      <View style={styles.picker}>
        <Pressable
          style={styles.field}
          onPress={() => {
            setOpen(!open);
            setQuery('');
          }}
          accessibilityRole="button"
          accessibilityLabel={`Store: ${store.name}. Change store`}
          accessibilityState={{ expanded: open }}>
          <Text style={styles.fieldText}>{store.name}</Text>
          <Text style={styles.caret}>{open ? '▴' : '▾'}</Text>
        </Pressable>
        {open && (
          <View style={styles.menu}>
            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Search stores"
              autoFocus
              autoCorrect={false}
              onSubmitEditing={() => matches[0] && pick(matches[0].id)}
              accessibilityLabel="Search stores"
            />
            <ScrollView style={styles.options} keyboardShouldPersistTaps="handled">
              {matches.map((st) => (
                <Pressable
                  key={st.id}
                  onPress={() => pick(st.id)}
                  style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: st.id === store.id }}>
                  <Text style={st.id === store.id ? styles.optionActive : undefined}>{st.name}</Text>
                </Pressable>
              ))}
              {matches.length === 0 && <Text style={styles.noMatch}>No stores match “{query}”</Text>}
            </ScrollView>
          </View>
        )}
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
  picker: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  field: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#ddd', borderRadius: 6 },
  fieldText: { flex: 1, fontSize: 16, fontWeight: '600' },
  caret: { marginLeft: 8, color: '#6f4e37' },
  menu: { marginTop: 6, borderWidth: 1, borderColor: '#ddd', borderRadius: 6 },
  search: { margin: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, borderWidth: 1, borderColor: '#ddd', borderRadius: 6 },
  options: { maxHeight: 240 },
  option: { paddingHorizontal: 12, paddingVertical: 10 },
  optionPressed: { backgroundColor: '#f1e7df' },
  optionActive: { color: '#6f4e37', fontWeight: '600' },
  noMatch: { padding: 12, color: '#888' },
  out: { color: '#c0392b', fontSize: 12, marginTop: 2 },
  step: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f1e7df', alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 20, color: '#6f4e37' },
  count: { width: 56, textAlign: 'center', fontSize: 16, marginHorizontal: 6, paddingVertical: 6, borderWidth: 1, borderColor: '#ddd', borderRadius: 6 },
});
