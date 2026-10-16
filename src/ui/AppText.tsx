import { Text, type TextProps } from 'react-native';
import { type, useTheme, type ColorName, type TypeVariant } from './theme';

type Props = TextProps & { variant?: TypeVariant; color?: ColorName };

export function AppText({ variant = 'body', color = 'ink', style, ...rest }: Props) {
  const { c } = useTheme();
  return <Text {...rest} style={[type[variant], { color: c[color] }, style]} />;
}
