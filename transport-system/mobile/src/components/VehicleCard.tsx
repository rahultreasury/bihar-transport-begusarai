import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Animated } from 'react-native';
import { Vehicle } from '@/types';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';

interface VehicleCardProps {
  vehicle: Vehicle;
  selected: boolean;
  onPress: () => void;
}

export const VehicleCard: React.FC<VehicleCardProps> = ({
  vehicle,
  selected,
  onPress,
}) => {
  const scaleAnim = React.useRef(new Animated.Value(selected ? 0.98 : 1)).current;

  React.useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: selected ? 0.98 : 1,
      useNativeDriver: true,
      tension: 100,
      friction: 8,
    }).start();
  }, [selected, scaleAnim]);

  const cardStyle = selected ? styles.cardSelected : styles.card;

  return (
    <Animated.View style={[styles.cardWrapper, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        style={[cardStyle, styles.touchable]}
        onPress={onPress}
        activeOpacity={0.9}
      >
        {/* Vehicle Image */}
        <View style={styles.imageContainer}>
          {vehicle.image ? (
            <Image
              source={vehicle.image}
              style={styles.vehicleImage}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.imagePlaceholderText}>{getVehicleIcon(vehicle.type)}</Text>
            </View>
          )}
          {selected && (
            <View style={styles.selectedBadge}>
              <Text style={styles.selectedBadgeText}>✓ Selected</Text>
            </View>
          )}
        </View>

        {/* Vehicle Info */}
        <View style={styles.infoContainer}>
          <Text style={styles.vehicleName}>{vehicle.name}</Text>
          <View style={styles.specsRow}>
            <View style={styles.specItem}>
              <Text style={styles.specIcon}>⚖️</Text>
              <Text style={styles.specText}>{vehicle.capacity}</Text>
            </View>
            <View style={styles.specItem}>
              <Text style={styles.specIcon}>,,</Text>
              <Text style={styles.specText}>{vehicle.lengthFt} ft</Text>
            </View>
            <View style={styles.specItem}>
              <Text style={styles.specIcon}>⛞</Text>
              <Text style={styles.specText}>{vehicle.wheels}W</Text>
            </View>
          </View>

          {/* Price */}
          <View style={styles.priceContainer}>
            <Text style={styles.priceLabel}>Est. ₹{vehicle.priceMin}–{vehicle.priceMax}/km</Text>
            <Text style={styles.priceHighlight}>Mid: ₹{vehicle.price}/km</Text>
          </View>

          {/* Best For */}
          <View style={styles.bestForContainer}>
            {vehicle.bestFor.slice(0, 2).map((useCase, index) => (
              <Text key={index} style={styles.bestForTag}>
                {useCase}
              </Text>
            ))}
            {vehicle.bestFor.length > 2 && (
              <Text style={styles.bestForTagMore}>
                +{vehicle.bestFor.length - 2} more
              </Text>
            )}
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

function getVehicleIcon(type: Vehicle['type']): string {
  switch (type) {
    case 'pickup':
      return '🚛';
    case 'mini_truck':
      return '🚚';
    case 'truck':
      return '🚛';
    case 'container':
      return '📦';
    default:
      return '🚚';
  }
}

const styles = StyleSheet.create({
  cardWrapper: {
    width: 240,
  },
  touchable: {
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
  },
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.border,
    borderRadius: BorderRadius.xl,
    ...Shadows.card,
  },
  cardSelected: {
    backgroundColor: Colors.primaryUltraLight,
    borderColor: Colors.primary,
    borderWidth: 3,
    ...Shadows.cardElevated,
  },
  imageContainer: {
    position: 'relative',
    height: 120,
    backgroundColor: Colors.surfaceSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  vehicleImage: {
    width: '100%',
    height: '100%',
    maxWidth: 200,
  },
  imagePlaceholder: {
    width: 100,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePlaceholderText: {
    fontSize: 40,
  },
  selectedBadge: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  selectedBadgeText: {
    color: Colors.textOnPrimary,
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.bold,
  },
  infoContainer: {
    padding: Spacing.md,
  },
  vehicleName: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  specsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: BorderRadius.md,
  },
  specItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  specIcon: {
    fontSize: Typography.size.sm,
  },
  specText: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    color: Colors.textSecondary,
  },
  priceContainer: {
    marginBottom: Spacing.md,
  },
  priceLabel: {
    fontSize: Typography.size.sm,
    color: Colors.textSecondary,
  },
  priceHighlight: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
    color: Colors.primary,
    marginTop: Spacing.xs,
  },
  bestForContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  bestForTag: {
    fontSize: Typography.size.xs,
    color: Colors.primary,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  bestForTagMore: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
});