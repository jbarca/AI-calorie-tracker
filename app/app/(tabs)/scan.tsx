import * as ImagePicker from 'expo-image-picker';
import { useIsFocused, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { CameraCapture } from '@/components/CameraCapture';
import { PhotoPreview } from '@/components/PhotoPreview';
import { Text, useColors } from '@/components/Themed';
import { useAnalyze } from '@/hooks/useAnalyze';
import { prepareMealPhoto, type PreparedPhoto } from '@/lib/image';

export default function ScanScreen() {
  const colors = useColors();
  const router = useRouter();
  const focused = useIsFocused();
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [hint, setHint] = useState('');
  const { analyzing, error, analyzePhoto, reset } = useAnalyze();

  const acceptPhoto = async (uri: string) => {
    setPreparing(true);
    try {
      reset();
      setPhoto(await prepareMealPhoto(uri));
    } catch {
      Alert.alert('Could not use photo', 'That photo could not be processed. Try another one.');
    } finally {
      setPreparing(false);
    }
  };

  const pickFromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (asset) await acceptPhoto(asset.uri);
  };

  const retake = () => {
    reset();
    setPhoto(null);
    setHint('');
  };

  const analyze = async () => {
    if (!photo) return;
    if (await analyzePhoto(photo, hint)) retake();
  };

  if (preparing) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  if (photo) {
    return (
      <View style={[styles.fill, { backgroundColor: colors.background }]}>
        <PhotoPreview
          uri={photo.uri}
          hint={hint}
          onHintChange={setHint}
          analyzing={analyzing}
          error={
            error ? { title: error.title, message: error.message, canRetry: error.retryable } : null
          }
          onAnalyze={() => void analyze()}
          onRetake={retake}
        />
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: '#000' }]}>
      {/* Only keep the camera running while this tab is visible. */}
      {focused ? (
        <CameraCapture
          onCapture={(uri) => void acceptPhoto(uri)}
          onPickFromGallery={() => void pickFromGallery()}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/add-text')}
        style={styles.textEntry}
      >
        <Text style={styles.textEntryLabel} lightColor="#fff" darkColor="#fff">
          No photo? Describe your meal
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  textEntry: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  textEntryLabel: { fontSize: 14, fontWeight: '600' },
});
