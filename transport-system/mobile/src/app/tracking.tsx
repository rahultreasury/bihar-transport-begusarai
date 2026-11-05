import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  RefreshControl,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '@/services/api';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SectionHeader } from '@/components/SectionHeader';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { Enquiry } from '@/types';

interface EnquiryData extends Omit<Enquiry, 'material'> {
  goods_description: string;
  events?: any[];
}

export default function TrackingScreen() {
  const { enquiryNumber } = useLocalSearchParams<{ enquiryNumber?: string }>();

  const [enquiry, setEnquiry] = useState<EnquiryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEnquiry = useCallback(async () => {
    if (!enquiryNumber) return;

    try {
      if (!refreshing) setLoading(true);
      setError(null);

      const response = await api.getEnquiry(enquiryNumber);
      if (response.success) {
        const apiEnquiry = response.data;
        // Map API response to local type
        setEnquiry({
          ...apiEnquiry,
          goods_description: apiEnquiry.material || '',
          events: apiEnquiry.events || [],
        });
      }
    } catch (err: any) {
      console.error('Failed to fetch tracking:', err);
      setError(err.response?.data?.message || 'Failed to load tracking details');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [enquiryNumber, refreshing]);

  useEffect(() => {
    fetchEnquiry();
    // Set up polling for status updates
    const interval = setInterval(() => {
      if (!loading) fetchEnquiry();
    }, 30000); // Poll every 30 seconds

    return () => clearInterval(interval);
  }, [fetchEnquiry, loading]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchEnquiry();
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatTime = (timeStr: string) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleString('en-IN', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'NEW':
        return { label: 'Request Received', color: Colors.info, bg: Colors.infoLight, icon: '📋', step: 1 };
      case 'UNDER_REVIEW':
        return { label: 'Under Review', color: Colors.info, bg: Colors.infoLight, icon: '🔍', step: 2 };
      case 'ASSIGNMENT_PENDING':
        return { label: 'Assigning Resources', color: Colors.warning, bg: Colors.warningLight, icon: '⏳', step: 3 };
      case 'VEHICLE_ASSIGNED':
        return { label: 'Vehicle Assigned', color: Colors.primary, bg: Colors.primaryLight, icon: '🚛', step: 4 };
      case 'DRIVER_ASSIGNED':
        return { label: 'Driver Assigned', color: Colors.primary, bg: Colors.primaryLight, icon: '👨‍✈️', step: 5 };
      case 'QUOTE_READY':
        return { label: 'Quote Prepared', color: Colors.accent, bg: Colors.accentLight, icon: '📝', step: 6 };
      case 'AWAITING_CUSTOMER_ACCEPTANCE':
        return { label: 'Awaiting Your Approval', color: Colors.accent, bg: Colors.accentLight, icon: '⏳', step: 7 };
      case 'CUSTOMER_ACCEPTED':
        return { label: 'Quote Accepted', color: Colors.success, bg: Colors.successLight, icon: '✅', step: 8 };
      case 'CONFIRMED':
        return { label: 'Confirmed', color: Colors.success, bg: Colors.successLight, icon: '✅', step: 9 };
      case 'CANCELLED':
        return { label: 'Cancelled', color: Colors.error, bg: Colors.errorLight, icon: '❌', step: 0 };
      case 'REJECTED':
        return { label: 'Rejected', color: Colors.error, bg: Colors.errorLight, icon: '❌', step: 0 };
      default:
        return { label: status, color: Colors.textSecondary, bg: Colors.surfaceSecondary, icon: '📄', step: 0 };
    }
  };

  const handleCallSupport = () => {
    Alert.alert('Call Support', 'Call 8210931799?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Call', onPress: () => { /* Linking.openURL('tel:8210931799'); */ } },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <View style={styles.loadingContent}>
          <Text style={styles.loadingText}>Loading tracking...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && !enquiry) {
    return (
      <SafeAreaView style={styles.errorContainer}>
        <View style={styles.errorContent}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Unable to Load Tracking</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <PrimaryButton
            title="Try Again"
            onPress={fetchEnquiry}
            style={styles.errorButton}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (!enquiry) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <View style={styles.loadingContent}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const statusConfig = getStatusConfig(enquiry.status);
  const allSteps = [
    { key: 'NEW', label: 'Received', icon: '📋' },
    { key: 'UNDER_REVIEW', label: 'Review', icon: '🔍' },
    { key: 'ASSIGNMENT_PENDING', label: 'Assigning', icon: '⏳' },
    { key: 'VEHICLE_ASSIGNED', label: 'Vehicle', icon: '🚛' },
    { key: 'DRIVER_ASSIGNED', label: 'Driver', icon: '👨‍✈️' },
    { key: 'QUOTE_READY', label: 'Quote Ready', icon: '📝' },
    { key: 'AWAITING_CUSTOMER_ACCEPTANCE', label: 'Approval', icon: '⏳' },
    { key: 'CUSTOMER_ACCEPTED', label: 'Accepted', icon: '✅' },
    { key: 'CONFIRMED', label: 'Confirmed', icon: '✅' },
  ];

  const currentStepIndex = allSteps.findIndex(s => s.key === enquiry.status);
  const isCompleted = ['CUSTOMER_ACCEPTED', 'CONFIRMED'].includes(enquiry.status);
  const isCancelled = ['CANCELLED', 'REJECTED'].includes(enquiry.status);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[Colors.primary]}
            progressViewOffset={60}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Track Booking</Text>
          <View style={{ width: 44 }} />
        </View>

        {/* Status Header */}
        <View style={styles.statusHeader}>
          <View style={[styles.statusBadgeLarge, { backgroundColor: statusConfig.bg }]}>
            <Text style={styles.statusIconLarge}>{statusConfig.icon}</Text>
            <Text style={[styles.statusTextLarge, { color: statusConfig.color }]}>
              {statusConfig.label}
            </Text>
          </View>
          <View style={styles.enquiryMeta}>
            <Text style={styles.enquiryNumber}>{enquiry.enquiry_number}</Text>
            <Text style={styles.enquiryDate}>Created {formatDate(enquiry.created_at)}</Text>
          </View>
        </View>

        {/* Progress Timeline */}
        <View style={styles.card}>
          <SectionHeader title="Progress" />
          <View style={styles.timeline}>
            {allSteps.map((step, index) => {
              const isActive = index <= currentStepIndex && !isCancelled;
              const isCurrent = index === currentStepIndex && !isCompleted && !isCancelled;
              const isPast = index < currentStepIndex;

              return (
                <View key={step.key} style={styles.timelineItem}>
                  <View style={styles.timelineConnector}>
                    {index < allSteps.length - 1 && (
                      <View
                        style={[
                          styles.timelineLine,
                          isPast && styles.timelineLineCompleted,
                        ]}
                      />
                    )}
                    <View
                      style={[
                        styles.timelineDot,
                        isCompleted && styles.timelineDotCompleted,
                        isActive && !isCompleted && styles.timelineDotActive,
                        isCurrent && styles.timelineDotCurrent,
                        isCancelled && styles.timelineDotCancelled,
                      ]}
                    >
                      <Text style={styles.timelineDotIcon}>{step.icon}</Text>
                    </View>
                  </View>
                  <View style={styles.timelineContent}>
                    <Text
                      style={[
                        styles.timelineStepLabel,
                        isActive && styles.timelineStepLabelActive,
                        isCompleted && styles.timelineStepLabelCompleted,
                        isCancelled && styles.timelineStepLabelCancelled,
                      ]}
                    >
                      {step.label}
                    </Text>
                    {isPast && (
                      <Text style={styles.timelineStepTime}>
                        {getStepTimestamp(step.key)}
                      </Text>
                    )}
                    {isCurrent && (
                      <Text style={styles.timelineStepCurrent}>Current Status</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Route Card */}
        <View style={styles.card}>
          <SectionHeader title="Route" />
          <View style={styles.routeCard}>
            <View style={styles.routePoint}>
              <View style={styles.routeLineTop} />
              <View style={styles.routeDotContainer}>
                <View style={[styles.routeDot, { backgroundColor: Colors.primary }]} />
              </View>
              <View style={styles.routeLineBottom} />
            </View>
            <View style={styles.routeDetails}>
              <View style={styles.routeItem}>
                <Text style={styles.routeItemLabel}>Pickup</Text>
                <Text style={styles.routeItemValue}>{enquiry.pickup_location}</Text>
                <Text style={styles.routeItemCity}>{enquiry.pickup_city}</Text>
              </View>
              <View style={styles.routeItem}>
                <Text style={styles.routeItemLabel}>Drop</Text>
                <Text style={styles.routeItemValue}>{enquiry.drop_location}</Text>
                <Text style={styles.routeItemCity}>{enquiry.drop_city}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Schedule & Vehicle */}
        <View style={styles.card}>
          <SectionHeader title="Schedule & Vehicle" />
          <View style={styles.scheduleGrid}>
            <View style={styles.scheduleItem}>
              <Text style={styles.scheduleIcon}>📅</Text>
              <View>
                <Text style={styles.scheduleLabel}>Pickup Date</Text>
                <Text style={styles.scheduleValue}>{formatDate(enquiry.pickup_date)}</Text>
              </View>
            </View>
            <View style={styles.scheduleItem}>
              <Text style={styles.scheduleIcon}>🕐</Text>
              <View>
                <Text style={styles.scheduleLabel}>Pickup Time</Text>
                <Text style={styles.scheduleValue}>{formatTime(enquiry.pickup_time)}</Text>
              </View>
            </View>
            <View style={styles.scheduleItem}>
              <Text style={styles.scheduleIcon}>🚚</Text>
              <View>
                <Text style={styles.scheduleLabel}>Vehicle</Text>
                <Text style={styles.scheduleValue}>
                  {enquiry.assigned_vehicle_number || enquiry.requested_vehicle_name || 'Not assigned yet'}
                </Text>
              </View>
            </View>
            {enquiry.assigned_driver_name && (
              <View style={styles.scheduleItem}>
                <Text style={styles.scheduleIcon}>👨‍✈️</Text>
                <View>
                  <Text style={styles.scheduleLabel}>Driver</Text>
                  <Text style={styles.scheduleValue}>{enquiry.assigned_driver_name}</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Shipment Details */}
        <View style={styles.card}>
          <SectionHeader title="Shipment Details" />
          <View style={styles.shipmentDetails}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Description</Text>
              <Text style={styles.detailValue}>{enquiry.goods_description}</Text>
            </View>
            {enquiry.estimated_price_min && enquiry.estimated_price_max && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Estimated Range</Text>
                <Text style={styles.detailValueHighlight}>
                  ₹{enquiry.estimated_price_min.toLocaleString()} – ₹{enquiry.estimated_price_max.toLocaleString()}
                </Text>
              </View>
            )}
            {enquiry.final_quoted_price && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Final Quoted Price</Text>
                <Text style={styles.detailValueHighlight}>
                  ₹{enquiry.final_quoted_price.toLocaleString()}
                </Text>
              </View>
            )}
            {enquiry.quote_remarks && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Remarks</Text>
                <Text style={styles.detailValue}>{enquiry.quote_remarks}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Events Timeline */}
        {enquiry.events && enquiry.events.length > 0 && (
          <View style={styles.card}>
            <SectionHeader title="Activity Log" />
            <View style={styles.eventsTimeline}>
              {enquiry.events.map((event: any, index: number) => (
                <View key={index} style={styles.eventItem}>
                  <View style={styles.eventTime}>
                    {formatDateTime(event.created_at)}
                  </View>
                  <View style={styles.eventContent}>
                    <Text style={styles.eventMessage}>{event.message}</Text>
                    {event.metadata && (
                      <Text style={styles.eventMetadata}>
                        {JSON.stringify(event.metadata, null, 2)}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Support */}
        <View style={styles.card}>
          <SectionHeader title="Need Help?" />
          <TouchableOpacity style={styles.supportButton} onPress={handleCallSupport}>
            <Text style={styles.supportIcon}>📞</Text>
            <View>
              <Text style={styles.supportLabel}>Call Customer Care</Text>
              <Text style={styles.supportNumber}>8210931799</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Bihar Transport • Begusarai, Bihar</Text>
          <Text style={styles.footerText}>Tracking updates every 30 seconds</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function getStepTimestamp(stepKey: string): string {
  // This would ideally come from the events, for now return empty
  return '';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingBottom: Spacing.xl,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContent: {
    alignItems: 'center',
  },
  loadingText: {
    fontSize: Typography.size.md,
    color: Colors.textSecondary,
    marginTop: Spacing.md,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },
  errorContent: {
    alignItems: 'center',
    gap: Spacing.md,
  },
  errorIcon: {
    fontSize: 48,
  },
  errorTitle: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
  },
  errorMessage: {
    fontSize: Typography.size.md,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  errorButton: {
    marginTop: Spacing.sm,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
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
  headerTitle: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.lg,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  statusBadgeLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
  },
  statusIconLarge: {
    fontSize: 28,
    marginRight: Spacing.md,
  },
  statusTextLarge: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.bold,
  },
  enquiryMeta: {
    alignItems: 'flex-end',
  },
  enquiryNumber: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.bold,
    color: Colors.primary,
    fontFamily: 'monospace',
  },
  enquiryDate: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    marginTop: Spacing.xs,
  },
  card: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    ...Shadows.card,
  },
  timeline: {
    marginTop: Spacing.sm,
  },
  timelineItem: {
    flexDirection: 'row',
    paddingVertical: Spacing.md,
  },
  timelineConnector: {
    width: 40,
    alignItems: 'center',
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: Colors.border,
  },
  timelineLineCompleted: {
    backgroundColor: Colors.success,
  },
  timelineDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.border,
    borderWidth: 3,
    borderColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  timelineDotCompleted: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  timelineDotActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  timelineDotCurrent: {
    boxShadow: `0 0 0 4px ${Colors.primaryLight}`,
  },
  timelineDotCancelled: {
    backgroundColor: Colors.error,
    borderColor: Colors.error,
  },
  timelineDotIcon: {
    fontSize: 16,
  },
  timelineContent: {
    flex: 1,
    paddingLeft: Spacing.md,
    marginTop: Spacing.xs,
  },
  timelineStepLabel: {
    fontSize: Typography.size.md,
    color: Colors.textSecondary,
    fontWeight: Typography.weight.medium,
  },
  timelineStepLabelActive: {
    color: Colors.primary,
    fontWeight: Typography.weight.bold,
  },
  timelineStepLabelCompleted: {
    color: Colors.success,
  },
  timelineStepLabelCancelled: {
    color: Colors.error,
  },
  timelineStepTime: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    marginTop: Spacing.xs,
  },
  timelineStepCurrent: {
    fontSize: Typography.size.xs,
    color: Colors.primary,
    fontWeight: Typography.weight.semibold,
    marginTop: Spacing.xs,
  },
  routeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  routePoint: {
    marginRight: Spacing.md,
    marginTop: Spacing.xs,
  },
  routeLineTop: {
    width: 2,
    height: 12,
    backgroundColor: Colors.border,
  },
  routeDotContainer: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  routeDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 3,
    borderColor: Colors.surface,
  },
  routeLineBottom: {
    width: 2,
    height: 12,
    backgroundColor: Colors.border,
  },
  routeDetails: {
    flex: 1,
    marginTop: Spacing.xs,
  },
  routeItem: {
    marginBottom: Spacing.md,
  },
  routeItemLabel: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  routeItemValue: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary,
  },
  routeItemCity: {
    fontSize: Typography.size.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  scheduleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  scheduleItem: {
    flex: 1,
    minWidth: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: BorderRadius.md,
  },
  scheduleIcon: {
    fontSize: 24,
    marginRight: Spacing.md,
  },
  scheduleLabel: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  scheduleValue: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary,
    marginTop: Spacing.xs,
  },
  shipmentDetails: {
    gap: Spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
  },
  detailLabel: {
    fontSize: Typography.size.md,
    color: Colors.textSecondary,
  },
  detailValue: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary,
    textAlign: 'right',
    flex: 1,
    marginLeft: Spacing.md,
  },
  detailValueHighlight: {
    color: Colors.primary,
    fontWeight: Typography.weight.bold,
  },
  eventsTimeline: {
    gap: Spacing.md,
  },
  eventItem: {
    flexDirection: 'row',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  eventTime: {
    width: 80,
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    fontFamily: 'monospace',
  },
  eventContent: {
    flex: 1,
  },
  eventMessage: {
    fontSize: Typography.size.md,
    color: Colors.textPrimary,
    fontWeight: Typography.weight.medium,
  },
  eventMetadata: {
    fontSize: Typography.size.xs,
    color: Colors.textSecondary,
    fontFamily: 'monospace',
    marginTop: Spacing.xs,
  },
  supportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  supportIcon: {
    fontSize: 24,
    marginRight: Spacing.md,
  },
  supportLabel: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary,
  },
  supportNumber: {
    fontSize: Typography.size.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  footer: {
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: Spacing.lg,
  },
  footerText: {
    fontSize: Typography.size.xs,
    color: Colors.textSecondary,
  },
});