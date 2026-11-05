import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View, ActivityIndicator } from 'react-native';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';

interface PrimaryButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: any;
  variant?: 'primary' | 'secondary' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

const variantStyles: Record<string, any> = {
  primary: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
    textColor: Colors.textOnPrimary,
  },
  secondary: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
    textColor: Colors.textPrimary,
  },
  outline: {
    backgroundColor: 'transparent',
    borderColor: Colors.primary,
    textColor: Colors.primary,
  },
};

const sizeStyles: Record<string, any> = {
  sm: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    fontSize: Typography.size.sm,
    borderRadius: BorderRadius.sm,
  },
  md: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    fontSize: Typography.size.md,
    borderRadius: BorderRadius.md,
  },
  lg: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    fontSize: Typography.size.lg,
    borderRadius: BorderRadius.lg,
  },
};

export const PrimaryButton: React.FC<PrimaryButtonProps> = ({
  title,
  onPress,
  disabled = false,
  loading = false,
  style,
  variant = 'primary',
  size = 'md',
  fullWidth = true,
}) => {
  const { backgroundColor, borderColor, textColor } = variantStyles[variant];
  const { paddingVertical, paddingHorizontal, fontSize, borderRadius } = sizeStyles[size];

  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      style={[
        styles.button,
        {
          backgroundColor: isDisabled ? Colors.border : backgroundColor,
          borderColor: isDisabled ? Colors.border : borderColor,
          paddingVertical,
          paddingHorizontal,
          borderRadius,
          borderWidth: variant === 'outline' ? 2 : 0,
          ...(variant === 'primary' && !isDisabled && Shadows.button),
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.9}
      accessibilityState={{ disabled: isDisabled }}
    >
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator
            size="small"
            color={variant === 'outline' ? Colors.primary : textColor}
          />
          <Text style={[styles.loadingText, { color: textColor, fontSize }]}>
            {title}
          </Text>
        </View>
      ) : (
        <Text
          style={[
            styles.buttonText,
            { color: isDisabled ? Colors.textTertiary : textColor, fontSize },
          ]}
        >
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  fullWidth: {
    width: '100%',
  },
  buttonText: {
    fontWeight: Typography.weight.semibold,
    textAlign: 'center',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  loadingText: {
    fontWeight: Typography.weight.semibold,
  },
});