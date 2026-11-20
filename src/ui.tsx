import { useState } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useInventory } from '@/inventory';

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  name: { fontSize: 16 },
  empty: { padding: 24, color: '#888', textAlign: 'center' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16 },
  button: { marginLeft: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 6, backgroundColor: '#6f4e37' },
  buttonText: { color: '#fff', fontWeight: '600' },
  delete: { color: '#c0392b' },
});

// Shown in every tab's header so people know a change reached the server.
export function SyncStatus() {
  const { saving, failed } = useInventory();
  const [label, color] = saving ? ['Saving…', '#c8a24a'] : failed ? ['Not saved', '#b4382b'] : ['Saved', '#3d9a5b'];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 16 }} accessibilityLiveRegion="polite">
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontSize: 12, color: failed && !saving ? color : '#6b625b' }}>{label}</Text>
    </View>
  );
}

const confirm = (message: string, onYes: () => void) =>
  Platform.OS === 'web'
    ? window.confirm(message) && onYes()
    : Alert.alert(message, undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: onYes }]);

// The Products and Stores tabs are the same add/delete list over a different collection.
export function NameList({ list, placeholder }: { list: 'products' | 'stores'; placeholder: string }) {
  const { data, add, remove } = useInventory();
  const [name, setName] = useState('');
  const submit = () => {
    if (!name.trim()) return;
    add(list, name.trim());
    setName('');
  };

  return (
    <View style={styles.screen}>
      <View style={styles.row}>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={placeholder} onSubmitEditing={submit} />
        <Pressable style={styles.button} onPress={submit} accessibilityRole="button">
          <Text style={styles.buttonText}>Add</Text>
        </Pressable>
      </View>
      <FlatList
        data={data[list]}
        keyExtractor={(i) => String(i.id)}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={[styles.name, { flex: 1 }]}>{item.name}</Text>
            <Pressable
              onPress={() => confirm(`Delete ${item.name} and its stock counts?`, () => remove(list, item.id))}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${item.name}`}>
              <Text style={styles.delete}>Delete</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}
