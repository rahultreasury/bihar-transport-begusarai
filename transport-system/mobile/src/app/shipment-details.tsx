import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useBookingForm } from '@/contexts/BookingFormContext';
import { LocationInput } from '@/components/LocationInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SectionHeader } from '@/components/SectionHeader';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';

const goodsCategories = [
  'General goods',
  'Construction material',
  'Machinery',
  'Furniture',
  'Agricultural goods',
  'Industrial goods',
  'Other',
];

const quantityUnits = [
  'Bags', 'Boxes', 'Bundles', 'PCS', 'Pieces', 'Cartons',
  'Drums', 'Pallets', 'Crates', 'Units', 'LOOSE',
];

const weightUnits = ['KG', 'Tons', 'Quintal', 'Metric Ton', 'FTL'];

export default function ShipmentDetailsScreen() {
  const {
    formData,
    updateFormData,
    currentStep,
    setCurrentStep,
    validateCurrentStep,
    priceEstimate,
  } = useBookingForm();

  const [selectedCategory, setSelectedCategory] = useState(formData.goods_type || '');
  const [selectedQuantityUnit, setSelectedQuantityUnit] = useState(formData.quantity_unit || '');
  const [selectedWeightUnit, setSelectedWeightUnit] = useState(formData.weight_unit || 'KG');
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showQuantityUnitPicker, setShowQuantityUnitPicker] = useState(false);
  const [showWeightUnitPicker, setShowWeightUnitPicker] = useState(false);

  const handleBack = () => {
    setCurrentStep(2);
    router.back();
  };

  const handleContinue = () => {
    if (validateCurrentStep()) {
      setCurrentStep(4);
      router.push('/review-submit');
    }
  };

  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category);
    updateFormData({ goods_type: category });
    setShowCategoryPicker(false);
  };

  const handleQuantityUnitSelect = (unit: string) => {
    setSelectedQuantityUnit(unit);
    updateFormData({ quantity_unit: unit });
    setShowQuantityUnitPicker(false);
  };

  const handleWeightUnitSelect = (unit: string) => {
    setSelectedWeightUnit(unit);
    updateFormData({ weight_unit: unit });
    setShowWeightUnitPicker(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={handleBack} style={styles.backButton}>
              <Text style={styles.backIcon}>←</Text>
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>Shipment Details</Text>
              <Text style={styles.headerSubtitle}>Step 3 of 4</Text>
            </View>
            <View style={{ width: 44 }} />
          </View>

          {/* Progress */}
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${(currentStep / 4) * 100}%` },
                ]}
              />
            </View>
            <View style={styles.progressSteps}>
              {[
                { label: 'Vehicle', step: 1 },
                { label: 'Route', step: 2 },
                { label: 'Shipment', step: 3 },
                { label: 'Review', step: 4 },
              ].map(({ label, step }) => (
                <View key={step} style={styles.progressStep}>
                  <View
                    style={[
                      styles.progressDot,
                      step <= currentStep && styles.progressDotActive,
                    ]}
                  />
                  <Text
                    style={[
                      styles.progressLabel,
                      step <= currentStep && styles.progressLabelActive,
                    ]}
                  >
                    {label}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* Shipment Form */}
          <View style={styles.section}>
            <SectionHeader
              title="Describe Your Shipment"
              subtitle="Help us find the right vehicle for your goods"
            />

            {/* Goods Description */}
            <LocationInput
              label="Goods Description *"
              placeholder="e.g., Household furniture, Construction materials, Machinery parts"
              value={formData.goods_description || ''}
              onChangeText={(text) => updateFormData({ goods_description: text })}
              multiline
              numberOfLines={4}
              icon="package"
              iconColor={Colors.primary}
              error={!formData.goods_description?.trim() ? 'Goods description is required' : undefined}
              autoCapitalize="words"
              rightElement={<Text style={styles.requiredBadge}>Required</Text>}
            />

            {/* Goods Category */}
            <View style={styles.dropdownContainer}>
              <Text style={styles.dropdownLabel}>Goods Category</Text>
              <TouchableOpacity
                style={[
                  styles.dropdown,
                  selectedCategory && styles.dropdownSelected,
                ]}
                onPress={() => setShowCategoryPicker(true)}
              >
                <View style={styles.dropdownContent}>
                  <Text style={styles.dropdownIcon}>📦</Text>
                  <Text
                    style={[
                      styles.dropdownText,
                      selectedCategory ? styles.dropdownTextSelected : styles.dropdownPlaceholder,
                    ]}
                  >
                    {selectedCategory || 'Select category (optional)'}
                  </Text>
                </View>
                <Text style={styles.dropdownArrow}>▼</Text>
              </TouchableOpacity>
            </View>

            {/* Quantity & Weight Row */}
            <View style={styles.row}>
              <View style={styles.halfField}>
                <LocationInput
                  label="Number of Items"
                  placeholder="1"
                  value={formData.number_of_items?.toString() || '1'}
                  onChangeText={(text) => updateFormData({ number_of_items: parseInt(text) || 1 })}
                  keyboardType="numeric"
                  icon="box"
                  iconColor={Colors.secondary}
                />
              </View>
              <View style={styles.halfField}>
                <TouchableOpacity
                  style={[
                    styles.dropdown,
                    selectedQuantityUnit && styles.dropdownSelected,
                  ]}
                  onPress={() => setShowQuantityUnitPicker(true)}
                >
                  <Text style={styles.dropdownLabel}>Quantity Unit</Text>
                  <View style={styles.dropdownContent}>
                    <Text style={styles.dropdownIcon}>📦</Text>
                    <Text
                      style={[
                        styles.dropdownText,
                        selectedQuantityUnit ? styles.dropdownTextSelected : styles.dropdownPlaceholder,
                      ]}
                    >
                      {selectedQuantityUnit || 'Select unit'}
                    </Text>
                  </View>
                  <Text style={styles.dropdownArrow}>▼</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Weight & Volume Row */}
            <View style={styles.row}>
              <View style={styles.halfField}>
                <LocationInput
                  label="Weight (kg)"
                  placeholder="Optional"
                  value={formData.goods_weight_kg?.toString() || ''}
                  onChangeText={(text) => updateFormData({ goods_weight_kg: parseFloat(text) || null })}
                  keyboardType="numeric"
                  icon="weight"
                  iconColor={Colors.secondary}
                />
              </View>
              <View style={styles.halfField}>
                <TouchableOpacity
                  style={[
                    styles.dropdown,
                    selectedWeightUnit && styles.dropdownSelected,
                  ]}
                  onPress={() => setShowWeightUnitPicker(true)}
                >
                  <Text style={styles.dropdownLabel}>Weight Unit</Text>
                  <View style={styles.dropdownContent}>
                    <Text style={styles.dropdownIcon}>⚖️</Text>
                    <Text
                      style={[
                        styles.dropdownText,
                        selectedWeightUnit ? styles.dropdownTextSelected : styles.dropdownPlaceholder,
                      ]}
                    >
                      {selectedWeightUnit || 'Select unit'}
                    </Text>
                  </View>
                  <Text style={styles.dropdownArrow}>▼</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Volume */}
            <LocationInput
              label="Volume (m³)"
              placeholder="Optional"
              value={formData.goods_volume?.toString() || ''}
              onChangeText={(text) => updateFormData({ goods_volume: parseFloat(text) || null })}
              keyboardType="numeric"
              icon="cube"
              iconColor={Colors.secondary}
            />

            {/* Fragile Toggle */}
            <View style={styles.toggleContainer}>
              <TouchableOpacity
                style={[
                  styles.toggleButton,
                  formData.fragile && styles.toggleActive,
                ]}
                onPress={() => updateFormData({ fragile: !formData.fragile })}
              >
                <View style={styles.toggleContent}>
                  <Text style={[
                    styles.toggleIcon,
                    formData.fragile && styles.toggleIconActive,
                  ]}>
                    🔴
                  </Text>
                  <Text style={[
                    styles.toggleText,
                    formData.fragile && styles.toggleTextActive,
                  ]}>
                    Fragile / Handle with Care
                  </Text>
                </View>
                <View
                  style={[
                    styles.toggleSwitch,
                    formData.fragile && styles.toggleSwitchActive,
                  ]}
                >
                  <View
                    style={[
                      styles.toggleThumb,
                      formData.fragile && styles.toggleThumbActive,
                    ]}
                  />
                </View>
              </TouchableOpacity>
            </View>

            {/* Special Instructions */}
            <LocationInput
              label="Special Instructions"
              placeholder="Any special handling, loading/unloading requirements..."
              value={formData.special_instructions || ''}
              onChangeText={(text) => updateFormData({ special_instructions: text })}
              multiline
              numberOfLines={3}
              icon="note"
              iconColor={Colors.secondary}
            />

            {/* Quick Summary */}
            {priceEstimate && (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>Quick Summary</Text>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Estimated Price</Text>
                  <Text style={styles.summaryValue}>
                    ₹{priceEstimate.estimated_price_min.toLocaleString()} – ₹{priceEstimate.estimated_price_max.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Distance</Text>
                  <Text style={styles.summaryValue}>~{priceEstimate.distance_km} km</Text>
                </View>
              </View>
            )}
          </View>

          {/* Navigation */}
          <View style={styles.navigation}>
            <TouchableOpacity style={styles.backButtonNav} onPress={handleBack}>
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
            <PrimaryButton
              title="Review & Submit"
              onPress={handleContinue}
              disabled={!validateCurrentStep()}
              style={styles.continueButton}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Category Picker Modal */}
      {showCategoryPicker && (
        <PickerModal
          title="Select Goods Category"
          items={goodsCategories}
          selected={selectedCategory}
          onSelect={handleCategorySelect}
          onClose={() => setShowCategoryPicker(false)}
        />
      )}

      {/* Quantity Unit Picker Modal */}
      {showQuantityUnitPicker && (
        <PickerModal
          title="Select Quantity Unit"
          items={quantityUnits}
          selected={selectedQuantityUnit}
          onSelect={handleQuantityUnitSelect}
          onClose={() => setShowQuantityUnitPicker(false)}
        />
      )}

      {/* Weight Unit Picker Modal */}
      {showWeightUnitPicker && (
        <PickerModal
          title="Select Weight Unit"
          items={weightUnits}
          selected={selectedWeightUnit}
          onSelect={handleWeightUnitSelect}
          onClose={() => setShowWeightUnitPicker(false)}
        />
      )}
    </SafeAreaView>
  );
}

// Picker Modal Component
function PickerModal({
  title,
  items,
  selected,
  onSelect,
  onClose,
}: {
  title: string;
  items: string[];
  selected: string;
  onSelect: (item: string) => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.modalOverlay} onTouchStart={onClose}>
      <View style={styles.modalContainer} onTouchStart={() => {}}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{title}</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.modalClose}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          style={styles.modalList}
          contentContainerStyle={styles.modalListContent}
        >
          {items.map((item) => (
            <TouchableOpacity
              key={item}
              style={[
                styles.modalItem,
                selected === item && styles.modalItemSelected,
              ]}
              onPress={() => onSelect(item)}
            >
              <Text
                style={[
                  styles.modalItemText,
                  selected === item && styles.modalItemTextSelected,
                ]}
              >
                {item}
              </Text>
              {selected === item && (
                <Text style={styles.modalItemCheck}>✓</Text>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backIcon: {
    fontSize: 24,
    color: Colors.textPrimary,
    fontWeight: 'bold',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: Typography.size.xs,
    color: Colors.textSecondary,
  },
  progressContainer: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  progressBar: {
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: Spacing.md,
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  progressSteps: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressStep: {
    alignItems: 'center',
    flex: 1,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.border,
    borderWidth: 2,
    borderColor: Colors.surface,
    marginBottom: Spacing.xs,
  },
  progressDotActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  progressLabel: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  progressLabelActive: {
    color: Colors.primary,
    fontWeight: Typography.weight.semibold,
  },
  section: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.lg,
  },
  requiredBadge: {
    fontSize: Typography.size.xs,
    color: Colors.error,
    fontWeight: Typography.weight.semibold,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    backgroundColor: Colors.errorLight,
    borderRadius: BorderRadius.xs,
  },
  dropdownContainer: {
    marginBottom: Spacing.md,
  },
  dropdownLabel: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.input,
  },
  dropdownSelected: {
    borderColor: Colors.primary,
  },
  dropdownContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  dropdownIcon: {
    fontSize: 20,
    marginRight: Spacing.md,
  },
  dropdownText: {
    fontSize: Typography.size.md,
    color: Colors.textPrimary,
    flex: 1,
  },
  dropdownTextSelected: {
    fontWeight: Typography.weight.semibold,
  },
  dropdownPlaceholder: {
    color: Colors.textTertiary,
  },
  dropdownArrow: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  halfField: {
    flex: 1,
  },
  toggleContainer: {
    marginVertical: Spacing.md,
  },
  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.input,
  },
  toggleActive: {
    backgroundColor: Colors.errorLight,
    borderColor: Colors.error,
  },
  toggleContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  toggleIcon: {
    fontSize: 20,
    marginRight: Spacing.md,
  },
  toggleIconActive: {
    // Icon changes color via text
  },
  toggleText: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.medium,
    color: Colors.textPrimary,
  },
  toggleTextActive: {
    color: Colors.error,
    fontWeight: Typography.weight.semibold,
  },
  toggleSwitch: {
    width: 52,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.border,
    padding: 2,
    justifyContent: 'center',
  },
  toggleSwitchActive: {
    backgroundColor: Colors.error,
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    ...Shadows.card,
  },
  toggleThumbActive: {
    marginLeft: 24,
  },
  summaryCard: {
    marginTop: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
  },
  summaryTitle: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
    color: Colors.primaryDark,
    marginBottom: Spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
  },
  summaryLabel: {
    fontSize: Typography.size.md,
    color: Colors.textSecondary,
  },
  summaryValue: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
    color: Colors.primary,
  },
  navigation: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: Spacing.md,
    marginTop: Spacing.xl,
    gap: Spacing.md,
  },
  backButtonNav: {
    flex: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    ...Shadows.card,
  },
  backButtonText: {
    fontSize: Typography.size.md,
    color: Colors.textPrimary,
    fontWeight: Typography.weight.semibold,
  },
  continueButton: {
    flex: 1,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '90%',
    maxHeight: '70%',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    ...Shadows.cardElevated,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
  },
  modalClose: {
    fontSize: 24,
    color: Colors.textSecondary,
  },
  modalList: {
    maxHeight: 300,
  },
  modalListContent: {
    paddingHorizontal: Spacing.md,
  },
  modalItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalItemSelected: {
    backgroundColor: Colors.primaryLight,
  },
  modalItemText: {
    fontSize: Typography.size.md,
    color: Colors.textPrimary,
  },
  modalItemTextSelected: {
    color: Colors.primary,
    fontWeight: Typography.weight.semibold,
  },
  modalItemCheck: {
    fontSize: Typography.size.md,
    color: Colors.primary,
    fontWeight: Typography.weight.bold,
  },
});