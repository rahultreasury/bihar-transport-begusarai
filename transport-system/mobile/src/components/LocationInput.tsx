import React, { forwardRef, useImperativeHandle } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';

interface LocationInputProps {
  label?: string;
  placeholder: string;
  value: string;
  onChangeText: (text: string, structured?: any) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  icon?: string;
  iconColor?: string;
  error?: string;
  multiline?: boolean;
  numberOfLines?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad';
  disabled?: boolean;
  rightElement?: React.ReactNode;
}

export const LocationInput = forwardRef<
  { focus: () => void; blur: () => void; clear: () => void },
  LocationInputProps
>((props, ref) => {
  const {
    label,
    placeholder,
    value,
    onChangeText,
    onFocus,
    onBlur,
    icon = 'location-pin',
    iconColor = Colors.primary,
    error,
    multiline = false,
    numberOfLines = 1,
    autoCapitalize = 'sentences',
    keyboardType = 'default',
    disabled = false,
    rightElement,
  } = props;

  const [focused, setFocused] = React.useState(false);
  const [inputValue, setInputValue] = React.useState(value);

  React.useEffect(() => {
    setInputValue(value);
  }, [value]);

  const focusAnim = React.useRef(new Animated.Value(0)).current;
  const borderAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(focusAnim, {
      toValue: focused ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();

    Animated.timing(borderAnim, {
      toValue: focused ? 1 : error ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [focused, error, focusAnim, borderAnim]);

  const animatedBorderColor = borderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [error ? Colors.borderError : Colors.border, error ? Colors.error : iconColor],
  });

  const animatedShadow = focusAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const handleFocus = () => {
    setFocused(true);
    onFocus?.();
  };

  const handleBlur = () => {
    setFocused(false);
    onBlur?.();
  };

  const handleChangeText = (text: string) => {
    setInputValue(text);
    onChangeText(text);
  };

  const clear = () => {
    setInputValue('');
    onChangeText('');
  };

  useImperativeHandle(ref, () => ({
    focus: () => {
      // TextInput focus would be triggered via ref if needed
    },
    blur: () => {},
    clear,
  }));

  const borderWidth = focused || error ? 2 : 1;

  const inputWrapperStyle = [
    styles.inputWrapper,
    {
      borderColor: animatedBorderColor,
      borderWidth,
      shadowOpacity: animatedShadow,
      shadowRadius: animatedShadow,
      elevation: animatedShadow,
    },
    multiline && styles.inputWrapperMultiline,
  ] as const;

  const iconWrapperStyle = [
    styles.iconWrapper,
    { backgroundColor: `${iconColor}15` },
    multiline && styles.iconWrapperMultiline,
  ] as const;

  const inputStyle = [
    styles.input,
    multiline && styles.inputMultiline,
    disabled && styles.inputDisabled,
  ] as const;

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <Animated.View style={inputWrapperStyle}>
        <View style={iconWrapperStyle}>
          <Text style={[styles.icon, { color: iconColor }]}>
            {getIcon(icon)}
          </Text>
        </View>
        <TextInput
          style={inputStyle}
          placeholder={placeholder}
          value={inputValue}
          onChangeText={handleChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          autoCapitalize={autoCapitalize}
          keyboardType={keyboardType}
          multiline={multiline}
          numberOfLines={numberOfLines}
          editable={!disabled}
          placeholderTextColor={Colors.textTertiary}
          selectionColor={iconColor}
          caretHidden={disabled}
        />
        {rightElement && <View style={styles.rightElement}>{rightElement}</View>}
        {value && !disabled && (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={clear}
            accessibilityLabel="Clear input"
          >
            <Text style={styles.clearIcon}>✕</Text>
          </TouchableOpacity>
        )}
      </Animated.View>
      {error && (
        <Animated.View
          style={[
            styles.errorContainer,
            { opacity: focused ? 0 : 1 },
          ]}
        >
          <Text style={[styles.errorText, { color: Colors.error }]}>
            {error}
          </Text>
        </Animated.View>
      )}
    </View>
  );
});

LocationInput.displayName = 'LocationInput';

function getIcon(name: string): string {
  switch (name) {
    case 'location-pin':
      return '📍';
    case 'package':
      return '📦';
    case 'tag':
      return '🏷️';
    case 'weight':
      return '⚖️';
    case 'box':
      return '📦';
    case 'cube':
      return '📐';
    case 'note':
      return '📝';
    case 'calendar':
      return '📅';
    case 'clock':
      return '🕐';
    case 'user':
      return '👤';
    case 'phone':
      return '📞';
    case 'email':
      return '✉️';
    default:
      return '📍';
  }
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.xs,
  },
  label: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    color: Colors.textSecondary,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 56,
    ...Shadows.input,
  },
  inputWrapperMultiline: {
    alignItems: 'flex-start',
    minHeight: 100,
  },
  iconWrapper: {
    marginRight: Spacing.md,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconWrapperMultiline: {
    marginTop: Spacing.sm,
  },
  icon: {
    fontSize: 18,
  },
  input: {
    flex: 1,
    fontSize: Typography.size.md,
    color: Colors.textPrimary,
  },
  inputMultiline: {
    paddingTop: Spacing.xs,
    textAlignVertical: 'top',
  },
  inputDisabled: {
    color: Colors.textTertiary,
  },
  rightElement: {
    marginLeft: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButton: {
    marginLeft: Spacing.sm,
    padding: Spacing.xs,
  },
  clearIcon: {
    fontSize: Typography.size.sm,
    color: Colors.textTertiary,
  },
  errorContainer: {
    marginTop: Spacing.xs,
    marginLeft: Spacing.sm,
  },
  errorText: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.medium,
  },
});