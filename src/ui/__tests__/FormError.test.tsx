import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { ValidationError } from '@/domain';
import { OdometerError } from '@/db/repo';
import { FormError } from '../FormError';

const GENERIC = 'Não foi possível salvar. Tente de novo.';

describe('FormError', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders nothing without an error', async () => {
    await render(<FormError error={null} />);
    expect(screen.toJSON()).toBeNull();
  });

  it('shows validation messages from the repo as they are', async () => {
    await render(<FormError error={new ValidationError('Data inválida.')} />);
    expect(screen.getByText('Data inválida.')).toBeOnTheScreen();

    await screen.rerender(<FormError error={new OdometerError('above_next')} />);
    expect(
      screen.getByText(
        'Esse KM é maior que uma leitura de data posterior. Confira o valor ou a data.',
      ),
    ).toBeOnTheScreen();
  });

  it('hides anything else behind a generic message', async () => {
    await render(<FormError error={new Error('SQLITE_BUSY: database is locked')} />);
    expect(screen.getByText(GENERIC)).toBeOnTheScreen();
    expect(screen.queryByText(/SQLITE/)).not.toBeOnTheScreen();

    await screen.rerender(<FormError error="boom" />);
    expect(screen.getByText(GENERIC)).toBeOnTheScreen();
  });

  it('announces itself: live region on Android, explicit announcement on iOS', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await render(<FormError error={new Error('x')} />);

    expect(screen.getByText(GENERIC)).toHaveProp('accessibilityLiveRegion', 'polite');
    expect(announce).toHaveBeenCalledWith(GENERIC); // jest-expo runs as iOS

    // The same failure again is a new error, so it is announced again.
    await screen.rerender(<FormError error={new Error('x')} />);
    expect(announce).toHaveBeenCalledTimes(2);
  });
});
