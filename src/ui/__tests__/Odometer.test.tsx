import { render, screen } from '@testing-library/react-native';
import { Odometer } from '../Odometer';

const hidden = { includeHiddenElements: true };

describe('Odometer', () => {
  it('labels an estimated reading in pt-BR', async () => {
    await render(<Odometer km={46250} estimated />);

    expect(screen.getByLabelText('Hodômetro estimado: 46.250 quilômetros')).toBeOnTheScreen();
    expect(screen.getByText('Estimativa de hoje')).toBeOnTheScreen();
  });

  it('labels a non-estimated reading without "estimado"', async () => {
    await render(<Odometer km={46250} />);

    expect(screen.getByLabelText('Hodômetro: 46.250 quilômetros')).toBeOnTheScreen();
    expect(screen.queryByText('Estimativa de hoje')).not.toBeOnTheScreen();
  });

  it('pads to at least 6 drums and grows past that', async () => {
    await render(<Odometer km={850} />);
    expect(screen.getAllByTestId('odometer-drum', hidden)).toHaveLength(6);

    await screen.rerender(<Odometer km={1234567} />);
    expect(screen.getAllByTestId('odometer-drum', hidden)).toHaveLength(7);
    expect(screen.getByLabelText('Hodômetro: 1.234.567 quilômetros')).toBeOnTheScreen();
  });

  it('hides the drums from screen readers', async () => {
    await render(<Odometer km={46250} />);

    expect(screen.queryAllByTestId('odometer-drum')).toHaveLength(0);
    expect(screen.getAllByTestId('odometer-drum', hidden)[0]).not.toBeVisible();
  });
});
