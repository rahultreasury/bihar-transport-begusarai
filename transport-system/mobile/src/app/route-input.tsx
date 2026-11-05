import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useBookingForm } from '@/contexts/BookingFormContext';
import { LocationInput } from '@/components/LocationInput';
import { SwapLocationsButton } from '@/components/SwapLocationsButton';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SectionHeader } from '@/components/SectionHeader';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import DateTimePicker from '@react-native-community/datetimepicker';

export default function RouteInputScreen() {
  const {
    formData,
    updateFormData,
    currentStep,
    setCurrentStep,
    validateCurrentStep,
    priceEstimate,
    fetchPriceEstimate,
  } = useBookingForm();

  const [pickupFocused, setPickupFocused] = useState(false);
  const [dropFocused, setDropFocused] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [datePickerMode, setDatePickerMode] = useState<'date' | 'time'>('date');

  const handlePickupChange = useCallback(
    (location: string, structured?: any) => {
      updateFormData({
        pickup_location: location,
        pickup_address: structured?.formattedAddress || '',
        pickup_city: structured?.city || 'Begusarai',
        pickup_state: structured?.state || 'Bihar',
        pickup_pincode: structured?.pincode || '',
        pickup_latitude: structured?.latitude,
        pickup_longitude: structured?.longitude,
      });
    },
    [updateFormData]
  );

  const handleDropChange = useCallback(
    (location: string, structured?: any) => {
      updateFormData({
        drop_location: location,
        drop_address: structured?.formattedAddress || '',
        drop_city: structured?.city || '',
        drop_state: structured?.state || 'Bihar',
        drop_pincode: structured?.pincode || '',
        drop_latitude: structured?.latitude,
        drop_longitude: structured?.longitude,
      });
    },
    [updateFormData]
  );

  const handleSwapLocations = useCallback(() => {
    updateFormData({
      pickup_location: formData.drop_location,
      pickup_address: formData.drop_address,
      pickup_city: formData.drop_city,
      pickup_state: formData.drop_state,
      pickup_pincode: formData.drop_pincode,
      pickup_latitude: formData.drop_latitude,
      pickup_longitude: formData.drop_longitude,
      drop_location: formData.pickup_location,
      drop_address: formData.pickup_address,
      drop_city: formData.pickup_city,
      drop_state: formData.pickup_state,
      drop_pincode: formData.pickup_pincode,
      drop_latitude: formData.pickup_latitude,
      drop_longitude: formData.pickup_longitude,
    });
    fetchPriceEstimate();
  }, [formData, updateFormData, fetchPriceEstimate]);

  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (selectedDate) {
      const dateStr = selectedDate.toISOString().split('T')[0];
      updateFormData({ pickup_date: dateStr });
      fetchPriceEstimate();
    }
    setShowDatePicker(false);
  };

  const handleTimeChange = (event: any, selectedDate?: Date) => {
    if (selectedDate) {
      const timeStr = selectedDate.toTimeString().slice(0, 5);
      updateFormData({ pickup_time: timeStr });
    }
    setShowTimePicker(false);
  };

  const handleBack = () => {
    setCurrentStep(1);
    router.back();
  };

  const handleContinue = () => {
    if (validateCurrentStep()) {
      setCurrentStep(3);
      router.push('/shipment-details');
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Select Date';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatTime = (timeStr: string) => {
    if (!timeStr) return 'Select Time';
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
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
              <Text style={styles.headerTitle}>Route Details</Text>
              <Text style={styles.headerSubtitle}>Step 2 of 4</Text>
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

          {/* Route Inputs */}
          <View style={styles.section}>
            <SectionHeader title="Pickup & Drop Locations" />
            <View style={styles.routeInputs}>
              <LocationInput
                label="Pickup Location"
                placeholder="Enter pickup address"
                value={formData.pickup_location || ''}
                onChangeText={handlePickupChange}
                onFocus={() => setPickupFocused(true)}
                onBlur={() => setPickupFocused(false)}
                icon="location-pin"
                iconColor={Colors.primary}
                error={!formData.pickup_location?.trim() ? 'Pickup location is required' : undefined}
                autoCapitalize="words"
                rightElement={<Text style={styles.requiredBadge}>Required</Text>}
              />
              <SwapLocationsButton onPress={handleSwapLocations} disabled={!formData.pickup_location && !formData.drop_location} />
              <LocationInput
                label="Drop Location"
                placeholder="Enter drop address"
                value={formData.drop_location || ''}
                onChangeText={handleDropChange}
                onFocus={() => setDropFocused(true)}
                onBlur={() => setDropFocused(false)}
                icon="location-pin"
                iconColor={Colors.accent}
                error={!formData.drop_location?.trim() ? 'Drop location is required' : undefined}
                autoCapitalize="words"
                rightElement={<Text style={styles.requiredBadge}>Required</Text>}
              />
            </View>

            {/* Schedule */}
            <View style={styles.scheduleSection}>
              <Text style={styles.scheduleTitle}>Pickup Schedule</Text>
              <View style={styles.scheduleRow}>
                <TouchableOpacity
                  style={[
                    styles.scheduleCard,
                    { borderColor: !formData.pickup_date ? Colors.borderError : Colors.border },
                  ]}
                  onPress={() => {
                    setDatePickerMode('date');
                    setShowDatePicker(true);
                  }}
                >
                  <View style={styles.scheduleIconWrapper}>
                    <Text style={styles.scheduleIcon}>📅</Text>
                  </View>
                  <View style={styles.scheduleContent}>
                    <Text style={styles.scheduleLabel}>Pickup Date</Text>
                    <Text
                      style={[
                        styles.scheduleValue,
                        !formData.pickup_date && styles.schedulePlaceholder,
                      ]}
                    >
                      {formatDate(formData.pickup_date || '')}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.scheduleCard,
                    { borderColor: !formData.pickup_time ? Colors.borderError : Colors.border },
                  ]}
                  onPress={() => {
                    setDatePickerMode('time');
                    setShowTimePicker(true);
                  }}
                >
                  <View style={styles.scheduleIconWrapper}>
                    <Text style={styles.scheduleIcon}>🕐</Text>
                  </View>
                  <View style={styles.scheduleContent}>
                    <Text style={styles.scheduleLabel}>Pickup Time</Text>
                    <Text
                      style={[
                        styles.scheduleValue,
                        !formData.pickup_time && styles.schedulePlaceholder,
                      ]}
                    >
                      {formatTime(formData.pickup_time || '')}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>

            {/* Price Preview */}
            {priceEstimate && (
              <View style={styles.pricePreview}>
                <Text style={styles.pricePreviewLabel}>Estimated Price</Text>
                <Text style={styles.pricePreviewValue}>
                  ₹{priceEstimate.estimated_price_min.toLocaleString()} – ₹{priceEstimate.estimated_price_max.toLocaleString()}
                </Text>
                <Text style={styles.pricePreviewDetail}>
                  ~{priceEstimate.distance_km} km • ₹{priceEstimate.rate_per_km}/km
                </Text>
              </View>
            )}
          </View>

          {/* Navigation */}
          <View style={styles.navigation}>
            <TouchableOpacity style={styles.backButtonNav} onPress={handleBack}>
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
            <PrimaryButton
              title="Continue to Shipment"
              onPress={handleContinue}
              disabled={!validateCurrentStep()}
              style={styles.continueButton}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Date Picker Modal */}
      {showDatePicker && (
        <View style={styles.modalOverlay} onTouchStart={() => setShowDatePicker(false)}>
          <View style={styles.modalContainer} onTouchStart={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Pickup Date</Text>
              <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              testID="date-picker"
              value={formData.pickup_date ? new Date(formData.pickup_date) : new Date()}
              mode="date"
              is24Hour={true}
              display="default"
              minimumDate={new Date()}
              onChange={handleDateChange}
              style={styles.datePicker}
            />
          </View>
        </View>
      )}

      {/* Time Picker Modal */}
      {showTimePicker && (
        <View style={styles.modalOverlay} onTouchStart={() => setShowTimePicker(false)}>
          <View style={styles.modalContainer} onTouchStart={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Pickup Time</Text>
              <TouchableOpacity onPress={() => setShowTimePicker(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              testID="time-picker"
              value={formData.pickup_time ? new Date(`2000-01-01T${formData.pickup_time}`) : new Date()}
              mode="time"
              is24Hour={true}
              display="default"
              onChange={handleTimeChange}
              style={styles.datePicker}
            />
          </View>
        </View>
      )}
    </SafeAreaView>
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
  routeInputs: {
    gap: Spacing.md,
    marginBottom: Spacing.lg,
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
  scheduleSection: {
    marginTop: Spacing.lg,
  },
  scheduleTitle: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  scheduleRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  scheduleCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    ...Shadows.card,
  },
  scheduleIconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  scheduleIcon: {
    fontSize: 20,
  },
  scheduleContent: {
    flex: 1,
  },
  scheduleLabel: {
    fontSize: Typography.size.xs,
    color: Colors.textSecondary,
    fontWeight: Typography.weight.semibold,
  },
  scheduleValue: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.medium,
    color: Colors.textPrimary,
    marginTop: Spacing.xs,
  },
  schedulePlaceholder: {
    color: Colors.textTertiary,
  },
  pricePreview: {
    marginTop: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
  },
  pricePreviewLabel: {
    fontSize: Typography.size.sm,
    color: Colors.primaryDark,
    fontWeight: Typography.weight.semibold,
  },
  pricePreviewValue: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    color: Colors.primary,
    marginTop: Spacing.xs,
  },
  pricePreviewDetail: {
    fontSize: Typography.size.xs,
    color: Colors.primaryDark,
    marginTop: Spacing.xs,
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
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.lg,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  datePicker: {
    height: 300,
  },
});