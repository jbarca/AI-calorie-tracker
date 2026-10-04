import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { DeleteAccountDialog } from '@/components/DeleteAccountDialog';

async function renderDialog(props: Partial<Parameters<typeof DeleteAccountDialog>[0]> = {}) {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  await render(
    <DeleteAccountDialog
      visible
      pending={false}
      error={null}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onCancel };
}

const deleteButton = () => screen.getByRole('button', { name: 'Delete my account' });

describe('DeleteAccountDialog', () => {
  it('enables the delete button only once DELETE is typed', async () => {
    const { onConfirm } = await renderDialog();
    expect(screen.getByText(/permanently deletes your account/)).toBeOnTheScreen();
    expect(screen.getByText(/meal\s+photos/)).toBeOnTheScreen();

    expect(deleteButton()).toBeDisabled();
    await fireEvent.press(deleteButton());
    expect(onConfirm).not.toHaveBeenCalled();

    const input = screen.getByLabelText('Type DELETE to confirm');
    await fireEvent.changeText(input, 'delete');
    expect(deleteButton()).toBeDisabled();

    await fireEvent.changeText(input, 'DELETE');
    expect(deleteButton()).toBeEnabled();
    await fireEvent.press(deleteButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel', async () => {
    const { onCancel } = await renderDialog();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the loading state and the last error', async () => {
    await renderDialog({ pending: true, error: 'Your account was not deleted.' });
    expect(screen.getByText('Your account was not deleted.')).toBeOnTheScreen();
    const button = screen.getByRole('button', { busy: true });
    expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
