import { parseLocalDayKey } from '@calorie/shared';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import { Text, useColors } from '@/components/Themed';
import { MacroColors } from '@/constants/Colors';

export type DayValue = { day: string; kcal: number };

type Props = {
  days: DayValue[];
  goal: number;
  height?: number;
  width: number;
};

const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
const LABEL_HEIGHT = 18;

/** Simple daily kcal bars with a dashed goal line; bars over the goal are red. */
export function WeekBarChart({ days, goal, width, height = 140 }: Props) {
  const colors = useColors();
  const max = Math.max(goal, ...days.map((d) => d.kcal), 1) * 1.1;
  const plotHeight = height - LABEL_HEIGHT;
  const slot = width / Math.max(days.length, 1);
  const barWidth = Math.min(28, slot * 0.6);
  const y = (kcal: number) => plotHeight - (kcal / max) * plotHeight;
  const average = days.length ? days.reduce((a, d) => a + d.kcal, 0) / days.length : 0;

  return (
    <View>
      <Svg
        width={width}
        height={height}
        accessibilityLabel={`Last ${days.length} days, average ${Math.round(average)} kcal per day`}
      >
        {days.map((d, i) => {
          const top = y(d.kcal);
          const x = i * slot + (slot - barWidth) / 2;
          return (
            <Rect
              key={d.day}
              x={x}
              y={top}
              width={barWidth}
              height={Math.max(plotHeight - top, d.kcal > 0 ? 2 : 0)}
              rx={4}
              fill={d.kcal > goal ? MacroColors.over : colors.accent}
            />
          );
        })}
        <Line
          x1={0}
          x2={width}
          y1={y(goal)}
          y2={y(goal)}
          stroke={colors.muted}
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        {days.map((d, i) => (
          <SvgText
            key={d.day}
            x={i * slot + slot / 2}
            y={height - 4}
            fontSize={11}
            fill={colors.muted}
            textAnchor="middle"
          >
            {weekday.format(parseLocalDayKey(d.day))}
          </SvgText>
        ))}
      </Svg>
      <Text style={[styles.caption, { color: colors.muted }]}>
        Avg {Math.round(average)} kcal/day · goal {goal}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  caption: { fontSize: 12, marginTop: 4 },
});
