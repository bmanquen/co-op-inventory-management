import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { styles } from '@/ui';

export type Item = { id: number; name: string };
export type Inventory = {
  products: Item[];
  stores: Item[];
  // Count per `${storeId}:${productId}`; a missing key means 0.
  stock: Record<string, number>;
};
type List = 'products' | 'stores';
type Action =
  | { type: 'add'; list: List; name: string }
  | { type: 'remove'; list: List; id: number }
  | { type: 'set'; storeId: number; productId: number; count: number }
  | { type: 'adjust'; storeId: number; productId: number; delta: number };

const CODE_KEY = 'coffee-inventory/team-code';
// shortcut: other devices' changes arrive by polling every 10s, switch to push (websocket/SSE) if staff need instant updates.
const POLL_MS = 10_000;

export const stockKey = (storeId: number, productId: number) => `${storeId}:${productId}`;

type Ctx = {
  data: Inventory;
  // True while a change is on its way to the server.
  saving: boolean;
  // The last request failed, so recent changes may not be saved.
  failed: boolean;
  setCount: (storeId: number, productId: number, count: number) => void;
  adjust: (storeId: number, productId: number, delta: number) => void;
  add: (list: List, name: string) => void;
  remove: (list: List, id: number) => void;
  signOut: () => void;
};

const InventoryContext = createContext<Ctx | null>(null);

export function InventoryProvider({ children }: { children: ReactNode }) {
  const [code, setCode] = useState<string | null | undefined>(undefined);
  const [data, setData] = useState<Inventory | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Request counters: a response only replaces local data when nothing newer is in flight,
  // so optimistic counts don't flicker back while taps are still saving.
  const seq = useRef({ next: 0, lastWrite: 0, inFlight: 0, writes: 0 });

  const call = useCallback(
    async (body?: Action, teamCode = code) => {
      const r = seq.current;
      const id = ++r.next;
      r.inFlight++;
      if (body) {
        r.lastWrite = id;
        r.writes++;
        setSaving(true);
      }
      try {
        const res = await fetch('/api/inventory', {
          method: body ? 'POST' : 'GET',
          headers: { 'content-type': 'application/json', 'x-team-code': teamCode ?? '' },
          body: body && JSON.stringify(body),
        });
        if (res.status === 401) {
          await AsyncStorage.removeItem(CODE_KEY);
          setCode(null);
          setError('Wrong team code.');
          return;
        }
        // 409 still carries the current inventory: someone else deleted that product or store.
        if (!res.ok && res.status !== 409) throw new Error(await res.text());
        const next = await res.json();
        if (r.inFlight === 1 && id >= r.lastWrite) setData(next);
        setError('');
      } catch {
        setError("Couldn't reach the server. Your last change may not have saved.");
      } finally {
        r.inFlight--;
        if (body && --r.writes === 0) setSaving(false);
      }
    },
    [code],
  );

  useEffect(() => {
    AsyncStorage.getItem(CODE_KEY).then(setCode);
  }, []);

  useEffect(() => {
    if (!code) return;
    // Loading from the server is the external sync this effect exists for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    call();
    const timer = setInterval(() => call(), POLL_MS);
    return () => clearInterval(timer);
  }, [code, call]);

  if (code === undefined) return null;
  if (!code)
    return (
      <SignIn
        error={error}
        onSubmit={(c) => {
          AsyncStorage.setItem(CODE_KEY, c);
          setError('');
          setCode(c);
        }}
      />
    );
  if (!data) return <Text style={styles.empty}>{error || 'Loading…'}</Text>;

  // Show the new count on tap; the server's answer replaces it once all saves land.
  const optimistic = (storeId: number, productId: number, next: (count: number) => number) => {
    const key = stockKey(storeId, productId);
    setData((d) => d && { ...d, stock: { ...d.stock, [key]: next(d.stock[key] ?? 0) } });
  };

  const ctx: Ctx = {
    data,
    saving,
    failed: !!error,
    setCount: (storeId, productId, count) => {
      count = Math.max(0, Math.floor(count) || 0);
      optimistic(storeId, productId, () => count);
      call({ type: 'set', storeId, productId, count });
    },
    adjust: (storeId, productId, delta) => {
      optimistic(storeId, productId, (n) => Math.max(0, n + delta));
      call({ type: 'adjust', storeId, productId, delta });
    },
    add: (list, name) => call({ type: 'add', list, name }),
    remove: (list, id) => call({ type: 'remove', list, id }),
    signOut: () => {
      AsyncStorage.removeItem(CODE_KEY);
      setData(null);
      setCode(null);
    },
  };

  return (
    <InventoryContext.Provider value={ctx}>
      {error ? <Text style={[styles.empty, styles.delete]}>{error}</Text> : null}
      {children}
    </InventoryContext.Provider>
  );
}

function SignIn({ error, onSubmit }: { error: string; onSubmit: (code: string) => void }) {
  const [value, setValue] = useState('');
  const submit = () => value.trim() && onSubmit(value.trim());
  return (
    <View style={[styles.screen, { justifyContent: 'center', padding: 24 }]}>
      <Text style={[styles.name, { marginBottom: 12 }]}>Enter your team code to see store inventory.</Text>
      <View style={{ flexDirection: 'row' }}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          onSubmitEditing={submit}
          placeholder="Team code"
          secureTextEntry
          autoCapitalize="none"
          accessibilityLabel="Team code"
        />
        <Pressable style={styles.button} onPress={submit} accessibilityRole="button">
          <Text style={styles.buttonText}>Sign in</Text>
        </Pressable>
      </View>
      {error ? <Text style={[styles.delete, { marginTop: 12 }]}>{error}</Text> : null}
    </View>
  );
}

export const useInventory = () => useContext(InventoryContext)!;
