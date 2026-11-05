import React from 'react';
import { View, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';

interface SwapLocationsButtonProps {
  onPress: () => void;
  disabled?: boolean;
}

export const SwapLocationsButton: React.FC<SwapLocationsButtonProps> = ({
  onPress,
  disabled = false,
}) => {
  const rotateAnim = React.useRef(new Animated.Value(0)).current;

  const handlePress = () => {
    if (disabled) return;
    
    Animated.sequence([
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(rotateAnim, {
        toValue: 0,
        duration: 0,
        useNativeDriver: true,
      }),
    ]).start();

    onPress();
  };

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <TouchableOpacity
      style={[styles.container, disabled && styles.disabled]}
      onPress={handlePress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      <Animated.View
        style={[
          styles.button,
          {
            transform: [{ rotate }],
          },
        ]}
      >
        <Animated.Text style={styles.icon}>⇅</Animated.Text>
      </Animated.View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
    marginVertical: Spacing.xs,
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.card,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  disabled: {
    opacity: 0.5,
  },
  icon: {
    fontSize: 20,
    color: Colors.primary,
    fontWeight: 'bold',
  },
});