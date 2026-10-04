import { useLocalSearchParams } from 'expo-router';

import { PlaceholderScreen } from '@/components/PlaceholderScreen';

export default function ReviewScreen() {
  const { scanId } = useLocalSearchParams<{ scanId: string }>();

  return (
    <PlaceholderScreen
      title="Review meal"
      description={`Edit the AI result for scan ${scanId ?? '(unknown)'} and save it to your log.`}
    />
  );
}
