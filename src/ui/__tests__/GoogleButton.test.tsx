import { render, screen, userEvent } from '@testing-library/react-native';
import { GoogleButton } from '../GoogleButton';

test('reads as Google’s approved wording and presses', async () => {
  const onPress = jest.fn();
  await render(<GoogleButton onPress={onPress} />);
  const button = screen.getByRole('button', { name: 'Continuar com o Google' });
  expect(button).toBeEnabled();
  expect(screen.getByText('Continuar com o Google')).toBeOnTheScreen();

  await userEvent.setup().press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('while loading it is busy and ignores presses', async () => {
  const onPress = jest.fn();
  await render(<GoogleButton onPress={onPress} loading />);
  const button = screen.getByRole('button', { name: 'Continuar com o Google' });
  expect(button).toBeBusy();
  expect(button).toBeDisabled();

  await userEvent.setup().press(button);
  expect(onPress).not.toHaveBeenCalled();
});
