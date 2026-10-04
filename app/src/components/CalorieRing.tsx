import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Text, useColors } from '@/components/Themed';
import { MacroColors } from '@/constants/Colors';

type Props = {
  consumed: number;
  goal: number;
  size?: number;
  strokeWidth?: number;
};

/** Ring showing kcal eaten against the daily goal; turns red once the goal is exceeded. */
export function CalorieRing({ consumed, goal, size = 180, strokeWidth = 14 }: Props) {
  const colors = useColors();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = goal > 0 ? Math.min(consumed / goal, 1) : 0;
  const over = consumed > goal;
  const remaining = Math.round(goal - consumed);

  return (
    <View
      style={[styles.container, { width: size, height: size }]}
      accessibilityRole="progressbar"
      accessibilityLabel={`${Math.round(consumed)} of ${goal} calories eaten`}
      accessibilityValue={{ min: 0, max: goal, now: Math.min(Math.round(consumed), goal) }}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.track}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={over ? MacroColors.over : colors.accent}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - progress)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.center}>
        <Text style={styles.value}>{Math.abs(remaining)}</Text>
        <Text style={[styles.label, { color: colors.muted }]}>
          {over ? 'kcal over' : 'kcal left'}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>
          {Math.round(consumed)} / {goal}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  center: { position: 'absolute', alignItems: 'center' },
  value: { fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'] },
  label: { fontSize: 13 },
  sub: { fontSize: 12, marginTop: 2, fontVariant: ['tabular-nums'] },
});
