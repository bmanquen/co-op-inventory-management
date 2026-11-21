import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { InventoryProvider } from '@/inventory';
import { SyncStatus } from '@/ui';

const icon = (emoji: string) =>
  function TabIcon() {
    return <Text style={{ fontSize: 18 }}>{emoji}</Text>;
  };

export default function Layout() {
  return (
    <InventoryProvider>
      <Tabs screenOptions={{ tabBarActiveTintColor: '#6f4e37', tabBarInactiveTintColor: '#6b625b', headerRight: SyncStatus }}>
        <Tabs.Screen name="index" options={{ title: 'Stock', tabBarIcon: icon('📦') }} />
        <Tabs.Screen name="products" options={{ title: 'Products', tabBarIcon: icon('☕') }} />
        <Tabs.Screen name="stores" options={{ title: 'Stores', tabBarIcon: icon('🏪') }} />
      </Tabs>
    </InventoryProvider>
  );
}
