import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';

type Props = {
  title: string;
  description: string;
  children?: ReactNode;
};

/** Temporary screen body used until the real screens land (Phase 4). */
export function PlaceholderScreen({ title, description, children }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  description: {
    fontSize: 15,
    textAlign: 'center',
    opacity: 0.7,
  },
});
