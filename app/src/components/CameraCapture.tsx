import { CameraView, useCameraPermissions, type FlashMode } from 'expo-camera';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useRef, useState } from 'react';

import { Button } from '@/components/Button';
import { Text, useColors } from '@/components/Themed';

type Props = {
  /** Called with the URI of the captured photo (full size; the caller resizes). */
  onCapture: (uri: string) => void;
  onPickFromGallery: () => void;
  disabled?: boolean;
};

const NEXT_FLASH: Record<'off' | 'on' | 'auto', 'off' | 'on' | 'auto'> = {
  off: 'auto',
  auto: 'on',
  on: 'off',
};

/** Camera preview with permission flow, flash toggle, shutter and a gallery fallback. */
export function CameraCapture({ onCapture, onPickFromGallery, disabled }: Props) {
  const colors = useColors();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [flash, setFlash] = useState<'off' | 'on' | 'auto'>('off');
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);

  if (!permission) {
    return <View style={styles.fill} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.permission, { backgroundColor: colors.background }]}>
        <Text style={styles.permissionTitle}>Camera access</Text>
        <Text style={[styles.permissionBody, { color: colors.muted }]}>
          Allow camera access to photograph your meals, or pick a photo from your library.
        </Text>
        {permission.canAskAgain ? (
          <Button title="Allow camera" onPress={() => void requestPermission()} />
        ) : (
          <Button title="Open Settings" onPress={() => void Linking.openSettings()} />
        )}
        <Button title="Choose from library" variant="secondary" onPress={onPickFromGallery} />
      </View>
    );
  }

  const capture = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      onCapture(photo.uri);
    } catch {
      Alert.alert('Could not take photo', 'Try again, or pick a photo from your library.');
    } finally {
      setCapturing(false);
    }
  };

  const busy = disabled || capturing || !ready;

  return (
    <View style={styles.fill}>
      <CameraView
        ref={cameraRef}
        style={styles.fill}
        facing="back"
        flash={flash satisfies FlashMode}
        onCameraReady={() => setReady(true)}
      />
      <View style={styles.controls}>
        <RoundButton
          label={`Flash ${flash}`}
          text={flash === 'off' ? '⚡︎ Off' : flash === 'on' ? '⚡︎ On' : '⚡︎ Auto'}
          onPress={() => setFlash(NEXT_FLASH[flash])}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => void capture()}
          style={({ pressed }) => [styles.shutter, { opacity: busy ? 0.5 : pressed ? 0.7 : 1 }]}
        >
          <View style={styles.shutterInner} />
        </Pressable>
        <RoundButton label="Choose from library" text="Library" onPress={onPickFromGallery} />
      </View>
    </View>
  );
}

function RoundButton({
  label,
  text,
  onPress,
}: {
  label: string;
  text: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.round, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Text style={styles.roundText} lightColor="#fff" darkColor="#fff">
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  permission: { justifyContent: 'center', padding: 24, gap: 12 },
  permissionTitle: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  permissionBody: { fontSize: 15, textAlign: 'center', marginBottom: 8 },
  controls: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  round: {
    minWidth: 72,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  roundText: { fontSize: 14, fontWeight: '600' },
});
