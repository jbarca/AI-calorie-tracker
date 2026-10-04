import { Link, Tabs } from 'expo-router';
import { Pressable, StyleSheet, Text, type ColorValue } from 'react-native';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';

import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

type IconName = SymbolViewProps['name'];

function TabIcon({ name, color }: { name: IconName; color: ColorValue }) {
  return <SymbolView name={name} tintColor={color} size={26} />;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme].tint,
        // Disable the static render of the header on web to prevent a hydration error.
        headerShown: useClientOnlyValue(false, true),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          headerRight: () => (
            <Link href="/add-text" asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add food by text"
                hitSlop={8}
                style={styles.headerButton}
              >
                <Text style={[styles.headerButtonText, { color: Colors[colorScheme].accent }]}>
                  Add by text
                </Text>
              </Pressable>
            </Link>
          ),
          tabBarIcon: ({ color }) => (
            <TabIcon
              name={{
                ios: 'flame',
                android: 'local_fire_department',
                web: 'local_fire_department',
              }}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: ({ color }) => (
            <TabIcon
              name={{ ios: 'camera', android: 'photo_camera', web: 'photo_camera' }}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color }) => (
            <TabIcon
              name={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => (
            <TabIcon
              name={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  headerButton: { paddingHorizontal: 16 },
  headerButtonText: { fontSize: 16, fontWeight: '600' },
});
