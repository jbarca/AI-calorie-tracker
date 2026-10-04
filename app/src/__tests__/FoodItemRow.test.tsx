import { describe, expect, it, jest } from '@jest/globals';
import { draftFromAnalysisItem } from '@calorie/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { FoodItemRow } from '@/components/FoodItemRow';

const item = draftFromAnalysisItem(
  {
    name: 'white rice',
    portion_desc: '1 cup cooked',
    estimated_grams: 158,
    kcal: 205,
    protein_g: 4.3,
    carbs_g: 44.5,
    fat_g: 0.4,
    confidence: 'medium',
  },
  'rice',
);

describe('FoodItemRow', () => {
  it('shows the item and wires up the controls', async () => {
    const onRename = jest.fn();
    const onGramsChange = jest.fn();
    const onRemove = jest.fn();
    await render(
      <FoodItemRow
        item={item}
        onRename={onRename}
        onGramsChange={onGramsChange}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByText('205 kcal')).toBeOnTheScreen();
    expect(screen.getByText('Medium')).toBeOnTheScreen();
    expect(screen.getByText('1 cup cooked')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Increase white rice by 10 grams'));
    expect(onGramsChange).toHaveBeenLastCalledWith(168);
    await fireEvent.press(screen.getByLabelText('Decrease white rice by 10 grams'));
    expect(onGramsChange).toHaveBeenLastCalledWith(148);

    await fireEvent.changeText(screen.getByLabelText('white rice grams'), '250');
    await fireEvent(screen.getByLabelText('white rice grams'), 'endEditing');
    expect(onGramsChange).toHaveBeenLastCalledWith(250);

    await fireEvent.changeText(screen.getByLabelText('Food name'), 'jasmine rice');
    expect(onRename).toHaveBeenCalledWith('jasmine rice');

    await fireEvent.press(screen.getByLabelText('Remove white rice'));
    expect(onRemove).toHaveBeenCalled();
  });
});
