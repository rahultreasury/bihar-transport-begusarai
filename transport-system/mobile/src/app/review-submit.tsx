import React, { useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useBookingForm } from '@/contexts/BookingFormContext';
import { useSession } from '@/contexts/SessionContext';
import { LocationInput } from '@/components/LocationInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SectionHeader } from '@/components/SectionHeader';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { getVehicleById } from '@/constants/vehicleCatalogue';

export default function ReviewSubmitScreen() {
  const {
    formData,
    updateFormData,
    currentStep,
    setCurrentStep,
    validateCurrentStep,
    priceEstimate,
    isSubmitting,
    submitError,
    submitBooking,
    resetForm,
  } = useBookingForm();

  const { sessionKey } = useSession();

  const [showSuccessModal, setShowSuccessModal] = React.useState(false);
  const [submittedEnquiryNumber, setSubmittedEnquiryNumber] = React.useState('');

  const handleBack = () => {
    setCurrentStep(3);
    router.back();
  };

  const handleSubmit = useCallback(async () => {
    if (!validateCurrentStep()) return;

    const result = await submitBooking();
    
    if (result && result.success) {
      const enquiryNumber = result.data.enquiryNumber;
      setSubmittedEnquiryNumber(enquiryNumber);
      setShowSuccessModal(true);
      
      // Navigate to confirmation screen after a brief delay
      setTimeout(() => {
        router.replace(`/confirmation?enquiryNumber=${enquiryNumber}`);
      }, 1500);
    }
  }, [validateCurrentStep, submitBooking, router]);

  const selectedVehicle = getVehicleById(formData.vehicle_type_required || '');

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
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
              <Text style={styles.headerTitle}>Review & Submit</Text>
              <Text style={styles.headerSubtitle}>Step 4 of 4</Text>
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

          {/* Review Card */}
          <View style={styles.section}>
            <SectionHeader title="Review Your Booking" subtitle="Please verify all details before submitting" />

            {/* Vehicle Summary */}
            <View style={styles.reviewCard}>
              <View style={styles.reviewSectionHeader}>
                <View style={styles.reviewSectionIcon}>
                  <Text style={styles.reviewSectionIconText}>🚚</Text>
                </View>
                <Text style={styles.reviewSectionTitle}>Vehicle</Text>
              </View>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Selected Vehicle</Text>
                <Text style={styles.reviewValue}>{selectedVehicle?.name}</Text>
              </View>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Capacity</Text>
                <Text style={styles.reviewValue}>{selectedVehicle?.capacity}</Text>
              </View>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Rate</Text>
                <Text style={styles.reviewValue}>{selectedVehicle?.priceLabel}</Text>
              </View>
            </View>

            {/* Route Summary */}
            <View style={styles.reviewCard}>
              <View style={styles.reviewSectionHeader}>
                <View style={styles.reviewSectionIcon}>
                  <Text style={styles.reviewSectionIconText}>📍</Text>
                </View>
                <Text style={styles.reviewSectionTitle}>Route</Text>
              </View>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Pickup</Text>
                <Text style={styles.reviewValue}>
                  {formData.pickup_location}, {formData.pickup_city}
                </Text>
              </View>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Drop</Text>
                <Text style={styles.reviewValue}>
                  {formData.drop_location}, {formData.drop_city}
                </Text>
              </View>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Date & Time</Text>
                <Text style={styles.reviewValue}>
                  {formatDate(formData.pickup_date || '')} at {formData.pickup_time}
                </Text>
              </View>
              {priceEstimate && (
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>Distance</Text>
                  <Text style={styles.reviewValue}>~{priceEstimate.distance_km} km</Text>
                </View>
              )}
            </View>

            {/* Shipment Summary */}
            <View style={styles.reviewCard}>
              <View style={styles.reviewSectionHeader}>
                <View style={styles.reviewSectionIcon}>
                  <Text style={styles.reviewSectionIconText}>📦</Text>
                </View>
                <Text style={styles.reviewSectionTitle}>Shipment</Text>
              </View>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Description</Text>
                <Text style={styles.reviewValue}>{formData.goods_description}</Text>
              </View>
              {formData.goods_type && (
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>Category</Text>
                  <Text style={styles.reviewValue}>{formData.goods_type}</Text>
                </View>
              )}
              {formData.goods_weight_kg && (
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>Weight</Text>
                  <Text style={styles.reviewValue}>
                    {formData.goods_weight_kg} {formData.weight_unit || 'kg'}
                  </Text>
                </View>
              )}
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Items</Text>
                <Text style={styles.reviewValue}>
                  {formData.number_of_items} {formData.quantity_unit || 'pcs'}
                </Text>
              </View>
              {formData.fragile && (
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>Special</Text>
                  <Text style={[styles.reviewValue, styles.reviewValueHighlight]}>
                    Fragile - Handle with Care
                  </Text>
                </View>
              )}
            </View>

            {/* Customer Details */}
            <View style={styles.reviewCard}>
              <View style={styles.reviewSectionHeader}>
                <View style={styles.reviewSectionIcon}>
                  <Text style={styles.reviewSectionIconText}>👤</Text>
                </View>
                <Text style={styles.reviewSectionTitle}>Customer Details</Text>
              </View>
              <LocationInput
                label="Full Name *"
                placeholder="Enter your full name"
                value={formData.customer_name || ''}
                onChangeText={(text) => updateFormData({ customer_name: text })}
                icon="user"
                iconColor={Colors.primary}
                error={!formData.customer_name?.trim() ? 'Name is required' : undefined}
                autoCapitalize="words"
                rightElement={<Text style={styles.requiredBadge}>Required</Text>}
              />
              <LocationInput
                label="Mobile Number *"
                placeholder="9876543210"
                value={formData.customer_mobile || ''}
                onChangeText={(text) => updateFormData({ customer_mobile: text })}
                keyboardType="phone-pad"
                icon="phone"
                iconColor={Colors.primary}
                error={
                  !formData.customer_mobile?.trim()
                    ? 'Mobile number is required'
                    : formData.customer_mobile && !/^[6-9]\d{9}$/.test(formData.customer_mobile.replace(/\D/g, '').slice(-10))
                    ? 'Enter a valid 10-digit Indian mobile number'
                    : undefined
                }
                rightElement={<Text style={styles.requiredBadge}>Required</Text>}
              />
              <LocationInput
                label="Email (Optional)"
                placeholder="your@email.com"
                value={formData.customer_email || ''}
                onChangeText={(text) => updateFormData({ customer_email: text })}
                keyboardType="email-address"
                icon="email"
                iconColor={Colors.secondary}
                autoCapitalize="none"
              />
            </View>

            {/* Price Summary */}
            {priceEstimate && (
              <View style={styles.priceSummaryCard}>
                <Text style={styles.priceSummaryTitle}>Price Estimate</Text>
                <View style={styles.priceSummaryRow}>
                  <Text style={styles.priceSummaryLabel}>Estimated Distance</Text>
                  <Text style={styles.priceSummaryValue}>~{priceEstimate.distance_km} km</Text>
                </View>
                <View style={styles.priceSummaryRow}>
                  <Text style={styles.priceSummaryLabel}>Rate ({selectedVehicle?.name})</Text>
                  <Text style={styles.priceSummaryValue}>₹{priceEstimate.rate_per_km}/km</Text>
                </View>
                <View style={styles.priceSummaryDivider} />
                <View style={styles.priceSummaryRow}>
                  <Text style={styles.priceSummaryLabel}>Estimated Range</Text>
                  <Text style={styles.priceSummaryValueHighlight}>
                    ₹{priceEstimate.estimated_price_min.toLocaleString()} – ₹{priceEstimate.estimated_price_max.toLocaleString()}
                  </Text>
                </View>
                <Text style={styles.priceSummaryNote}>
                  Final price will be confirmed by our team after review.
                </Text>
              </View>
            )}

            {/* Error Message */}
            {submitError && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorIcon}>⚠️</Text>
                <Text style={styles.errorText}>{submitError}</Text>
              </View>
            )}

            {/* Submit Button */}
            <PrimaryButton
              title="Book Transport"
              onPress={handleSubmit}
              disabled={!validateCurrentStep()}
              loading={isSubmitting}
              style={styles.submitButton}
              size="lg"
            />

            <Text style={styles.termsText}>
              By booking, you agree to our Terms of Service and Privacy Policy.
              Our team will contact you shortly to confirm the final price.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Success Modal */}
      {showSuccessModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.successModal}>
            <View style={styles.successIcon}>✅</View>
            <Text style={styles.successTitle}>Booking Submitted!</Text>
            <Text style={styles.successSubtitle}>
              Your transport request has been received.
            </Text>
            <Text style={styles.successEnquiryNumber}>
              Enquiry: {submittedEnquiryNumber}
            </Text>
            <Text style={styles.successNote}>
              Redirecting to confirmation...
            </Text>
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
  reviewCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    ...Shadows.card,
  },
  reviewSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  reviewSectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  reviewSectionIconText: {
    fontSize: 18,
  },
  reviewSectionTitle: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
  },
  reviewLabel: {
    fontSize: Typography.size.md,
    color: Colors.textSecondary,
  },
  reviewValue: {
    fontSize: Typography.size.md,
    color: Colors.textPrimary,
    fontWeight: Typography.weight.semibold,
    textAlign: 'right',
    flex: 1,
    marginLeft: Spacing.md,
  },
  reviewValueHighlight: {
    color: Colors.error,
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
  priceSummaryCard: {
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  priceSummaryTitle: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
    color: Colors.primaryDark,
    marginBottom: Spacing.md,
  },
  priceSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
  },
  priceSummaryLabel: {
    fontSize: Typography.size.md,
    color: Colors.textSecondary,
  },
  priceSummaryValue: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary,
  },
  priceSummaryValueHighlight: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
    color: Colors.primary,
  },
  priceSummaryDivider: {
    height: 1,
    backgroundColor: Colors.primary,
    opacity: 0.3,
    marginVertical: Spacing.sm,
  },
  priceSummaryNote: {
    fontSize: Typography.size.xs,
    color: Colors.primaryDark,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    backgroundColor: Colors.errorLight,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: Colors.error,
  },
  errorIcon: {
    fontSize: 20,
  },
  errorText: {
    fontSize: Typography.size.md,
    color: Colors.error,
    flex: 1,
  },
  submitButton: {
    marginTop: Spacing.md,
    marginBottom: Spacing.md,
  },
  termsText: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    textAlign: 'center',
    lineHeight: Typography.lineHeight.relaxed * Typography.size.xs,
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
    zIndex: 100,
  },
  successModal: {
    width: '85%',
    padding: Spacing.xl,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    alignItems: 'center',
    ...Shadows.cardElevated,
  },
  successIcon: {
    fontSize: 64,
    marginBottom: Spacing.md,
  },
  successTitle: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    color: Colors.success,
    marginBottom: Spacing.xs,
  },
  successSubtitle: {
    fontSize: Typography.size.md,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  successEnquiryNumber: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
    color: Colors.primary,
    fontFamily: 'monospace',
  },
  successNote: {
    fontSize: Typography.size.sm,
    color: Colors.textTertiary,
    marginTop: Spacing.md,
  },
});