import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { CalorieRing } from '@/components/CalorieRing';

describe('CalorieRing', () => {
  it('shows calories left under the goal', async () => {
    await render(<CalorieRing consumed={1500} goal={2000} />);
    expect(screen.getByText('500')).toBeOnTheScreen();
    expect(screen.getByText('kcal left')).toBeOnTheScreen();
    expect(screen.getByLabelText('1500 of 2000 calories eaten')).toBeOnTheScreen();
  });

  it('shows calories over the goal', async () => {
    await render(<CalorieRing consumed={2300} goal={2000} />);
    expect(screen.getByText('300')).toBeOnTheScreen();
    expect(screen.getByText('kcal over')).toBeOnTheScreen();
  });
});
