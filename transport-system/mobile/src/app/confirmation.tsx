import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Image,
  Alert,
  Share,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '@/services/api';
import { useSession } from '@/contexts/SessionContext';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SectionHeader } from '@/components/SectionHeader';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '@/constants/theme';
import { Enquiry } from '@/types';

interface EnquiryData extends Omit<Enquiry, 'material'> {
  goods_description: string;
  assigned_vehicle_number?: string | null;
  assigned_vehicle_type?: string | null;
  assigned_driver_name?: string | null;
  vehicle_assigned_at?: string | null;
  driver_assigned_at?: string | null;
}

export default function ConfirmationScreen() {
  const { enquiryNumber } = useLocalSearchParams<{ enquiryNumber?: string }>();
  const enquiryNumberStr = enquiryNumber || '';
  const { sessionKey, getEnquiryToken } = useSession();

  const [enquiry, setEnquiry] = useState<EnquiryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<any>(null);
  const [customerCare, setCustomerCare] = useState<any>(null);

  const fetchEnquiry = useCallback(async () => {
    if (!enquiryNumberStr) {
      setError('No enquiry number provided');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      // Get the enquiry token for this enquiry
      const token = getEnquiryToken(enquiryNumberStr);
      
      // Fetch enquiry details
      const enquiryResponse = await api.getEnquiry(enquiryNumberStr);
      if (enquiryResponse.success) {
        const apiEnquiry = enquiryResponse.data;
        // Map API response to local type
        setEnquiry({
          ...apiEnquiry,
          goods_description: apiEnquiry.material || '',
          assigned_vehicle_number: apiEnquiry.assigned_vehicle_number || null,
          assigned_vehicle_type: apiEnquiry.assigned_vehicle_type || null,
          assigned_driver_name: apiEnquiry.assigned_driver_name || null,
          vehicle_assigned_at: apiEnquiry.vehicle_assigned_at || null,
          driver_assigned_at: apiEnquiry.driver_assigned_at || null,
        });
      }

      // Fetch quote details
      try {
        const quoteResponse = await api.getQuote(enquiryNumberStr);
        if (quoteResponse.success) {
          setQuote(quoteResponse.data);
        }
      } catch (quoteError) {
        console.warn('Quote fetch failed:', quoteError);
      }

      // Fetch customer care info
      try {
        const careResponse = await api.getCustomerCare(enquiryNumberStr);
        if (careResponse.success) {
          setCustomerCare(careResponse.data);
        }
      } catch (careError) {
        console.warn('Customer care fetch failed:', careError);
      }

      setError(null);
    } catch (err: any) {
      console.error('Failed to fetch enquiry:', err);
      setError(err.response?.data?.message || 'Failed to load booking details');
    } finally {
      setLoading(false);
    }
  }, [enquiryNumberStr, getEnquiryToken]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchEnquiry();
  }, [fetchEnquiry]);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
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

  const formatCurrency = (amount: number | null) => {
    if (amount === null || amount === undefined) return '—';
    return `₹${amount.toLocaleString('en-IN')}`;
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'NEW':
      case 'UNDER_REVIEW':
        return { label: 'Under Review', color: Colors.info, bg: Colors.infoLight, icon: '🔍' };
      case 'ASSIGNMENT_PENDING':
      case 'VEHICLE_ASSIGNED':
      case 'DRIVER_ASSIGNED':
        return { label: 'Assigning Resources', color: Colors.warning, bg: Colors.warningLight, icon: '🚛' };
      case 'QUOTE_READY':
        return { label: 'Quote Ready', color: Colors.primary, bg: Colors.primaryLight, icon: '📋' };
      case 'AWAITING_CUSTOMER_ACCEPTANCE':
        return { label: 'Awaiting Your Approval', color: Colors.accent, bg: Colors.accentLight, icon: '⏳' };
      case 'CUSTOMER_ACCEPTED':
      case 'CONFIRMED':
        return { label: 'Confirmed', color: Colors.success, bg: Colors.successLight, icon: '✅' };
      case 'CANCELLED':
      case 'REJECTED':
        return { label: status === 'CANCELLED' ? 'Cancelled' : 'Rejected', color: Colors.error, bg: Colors.errorLight, icon: '❌' };
      default:
        return { label: status, color: Colors.textSecondary, bg: Colors.surfaceSecondary, icon: '📄' };
    }
  };

  const handleCallSupport = () => {
    const phone = customerCare?.phone || '8210931799';
    Alert.alert(
      'Call Customer Care',
      `Call ${phone}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Call', onPress: () => { /* Linking.openURL(`tel:${phone}`); */ } },
      ]
    );
  };

  const handleWhatsApp = () => {
    const url = customerCare?.whatsappUrl || `https://wa.me/918210931799`;
    Alert.alert(
      'WhatsApp Support',
      'Open WhatsApp to chat with our support team?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open WhatsApp', onPress: () => { /* Linking.openURL(url); */ } },
      ]
    );
  };

  const handleShare = async () => {
    if (!enquiry) return;
    try {
      await Share.share({
        title: `Bihar Transport - Booking ${enquiry.enquiry_number}`,
        message: `My transport booking ${enquiry.enquiry_number}:\nPickup: ${enquiry.pickup_location}, ${enquiry.pickup_city}\nDrop: ${enquiry.drop_location}, ${enquiry.drop_city}\nDate: ${formatDate(enquiry.pickup_date)} at ${formatTime(enquiry.pickup_time)}`,
      });
    } catch (err) {
      console.warn('Share failed:', err);
    }
  };

  const handleTrack = () => {
    if (enquiry) {
      router.push(`/tracking?enquiryNumber=${enquiry.enquiry_number}`);
    }
  };

  const handleNewBooking = () => {
    router.replace('/');
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <View style={styles.loadingContent}>
          <Text style={styles.loadingText}>Loading your booking...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && !enquiry) {
    return (
      <SafeAreaView style={styles.errorContainer}>
        <View style={styles.errorContent}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Unable to Load Booking</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <PrimaryButton
            title="Try Again"
            onPress={fetchEnquiry}
            style={styles.errorButton}
          />
          <PrimaryButton
            title="New Booking"
            onPress={handleNewBooking}
            variant="outline"
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Status Header */}
        <View style={styles.statusHeader}>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg }]}>
            <Text style={styles.statusIcon}>{statusConfig.icon}</Text>
            <Text style={[styles.statusText, { color: statusConfig.color }]}>
              {statusConfig.label}
            </Text>
          </View>
          <View style={styles.enquiryNumberContainer}>
            <Text style={styles.enquiryNumberLabel}>Enquiry Number</Text>
            <Text style={styles.enquiryNumber}>{enquiry.enquiry_number}</Text>
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

        {/* Schedule Card */}
        <View style={styles.card}>
          <SectionHeader title="Schedule" />
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
                <Text style={styles.scheduleValue}>{enquiry.requested_vehicle_name || 'To be assigned'}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Shipment Card */}
        <View style={styles.card}>
          <SectionHeader title="Shipment Details" />
          <View style={styles.shipmentDetails}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Description</Text>
              <Text style={styles.detailValue}>{enquiry.goods_description}</Text>
            </View>
            {enquiry.estimated_price_min && enquiry.estimated_price_max && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Estimated Price</Text>
                <Text style={styles.detailValueHighlight}>
                  {formatCurrency(enquiry.estimated_price_min)} – {formatCurrency(enquiry.estimated_price_max)}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Quote Card */}
        {quote?.action_required && quote?.final_quoted_price && (
          <View style={[styles.card, styles.quoteCard]}>
            <SectionHeader title="Quote Received" subtitle="A final quote is awaiting your decision" />
            <View style={styles.quoteContent}>
              <View style={styles.quotePrice}>
                <Text style={styles.quoteLabel}>Final Quoted Price</Text>
                <Text style={styles.quoteAmount}>{formatCurrency(quote.final_quoted_price)}</Text>
              </View>
              {quote.quote_remarks && (
                <Text style={styles.quoteRemarks}>&ldquo;{quote.quote_remarks}&rdquo;</Text>
              )}
              <View style={styles.quoteActions}>
                <PrimaryButton
                  title="Accept Quote"
                  onPress={async () => {
                    try {
                      await api.acceptQuote(enquiryNumberStr);
                      fetchEnquiry();
                    } catch (err) {
                      Alert.alert('Error', 'Failed to accept quote. Please try again.');
                    }
                  }}
                  style={styles.quoteAcceptButton}
                />
                <PrimaryButton
                  title="Decline Quote"
                  onPress={async () => {
                    Alert.alert(
                      'Decline Quote',
                      'Are you sure you want to decline this quote?',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Decline',
                          style: 'destructive',
                          onPress: async () => {
                            try {
                              await api.rejectQuote(enquiryNumberStr);
                              fetchEnquiry();
                            } catch (err) {
                              Alert.alert('Error', 'Failed to decline quote. Please try again.');
                            }
                          },
                        },
                      ]
                    );
                  }}
                  variant="outline"
                  style={styles.quoteRejectButton}
                />
              </View>
            </View>
          </View>
        )}

        {/* Final Quote Display */}
        {quote?.final_quoted_price && !quote?.action_required && (
          <View style={[styles.card, styles.finalQuoteCard]}>
            <SectionHeader title="Final Quote" subtitle={quote.status === 'CONVERTED' ? 'Quote accepted - booking confirmed' : 'Quote status: ' + quote.price_status} />
            <View style={styles.finalQuoteContent}>
              <View style={styles.finalQuoteRow}>
                <Text style={styles.finalQuoteLabel}>Quoted Price</Text>
                <Text style={styles.finalQuoteAmount}>{formatCurrency(quote.final_quoted_price)}</Text>
              </View>
              {quote.quotation && (
                <View style={styles.quoteBreakdown}>
                  {quote.quotation.freight_amount && (
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabel}>Freight</Text>
                      <Text style={styles.breakdownValue}>{formatCurrency(quote.quotation.freight_amount)}</Text>
                    </View>
                  )}
                  {quote.quotation.gst_amount && (
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabel}>GST ({quote.quotation.gst_percentage}%)</Text>
                      <Text style={styles.breakdownValue}>{formatCurrency(quote.quotation.gst_amount)}</Text>
                    </View>
                  )}
                  {quote.quotation.additional_charges && (
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabel}>Additional Charges</Text>
                      <Text style={styles.breakdownValue}>{formatCurrency(quote.quotation.additional_charges)}</Text>
                    </View>
                  )}
                  <View style={[styles.breakdownRow, styles.breakdownTotal]}>
                    <Text style={styles.breakdownLabel}>Total</Text>
                    <Text style={styles.breakdownTotalValue}>{formatCurrency(quote.quotation.total_amount)}</Text>
                  </View>
                </View>
              )}
              {quote.quote_remarks && (
                <Text style={styles.quoteRemarks}>Remarks: &ldquo;{quote.quote_remarks}&rdquo;</Text>
              )}
            </View>
          </View>
        )}

        {/* Customer Info Card */}
        <View style={styles.card}>
          <SectionHeader title="Customer Details" />
          <View style={styles.customerDetails}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Name</Text>
              <Text style={styles.detailValue}>{enquiry.customer_name}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Mobile</Text>
              <Text style={styles.detailValue}>{enquiry.customer_mobile}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Booking Date</Text>
              <Text style={styles.detailValue}>{formatDate(enquiry.created_at)}</Text>
            </View>
          </View>
        </View>

        {/* Support Card */}
        <View style={styles.card}>
          <SectionHeader title="Need Help?" />
          <View style={styles.supportGrid}>
            <TouchableOpacity style={styles.supportButton} onPress={handleCallSupport}>
              <Text style={styles.supportIcon}>📞</Text>
              <View>
                <Text style={styles.supportLabel}>Call Support</Text>
                <Text style={styles.supportNumber}>{customerCare?.phone || '8210931799'}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.supportButton} onPress={handleWhatsApp}>
              <Text style={styles.supportIcon}>💬</Text>
              <View>
                <Text style={styles.supportLabel}>WhatsApp</Text>
                <Text style={styles.supportNumber}>Chat with us</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          <PrimaryButton
            title="Track This Booking"
            onPress={handleTrack}
            style={styles.trackButton}
          />
          <PrimaryButton
            title="Book Another Transport"
            onPress={handleNewBooking}
            variant="outline"
            style={styles.newBookingButton}
          />
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Bihar Transport • Begusarai, Bihar</Text>
          <Text style={styles.footerText}>Your trusted transport partner</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
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
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  statusIcon: {
    fontSize: 18,
    marginRight: Spacing.xs,
  },
  statusText: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
  },
  enquiryNumberContainer: {
    alignItems: 'flex-end',
  },
  enquiryNumberLabel: {
    fontSize: Typography.size.xs,
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  enquiryNumber: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
    color: Colors.primary,
    fontFamily: 'monospace',
  },
  card: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    ...Shadows.card,
  },
  quoteCard: {
    borderWidth: 2,
    borderColor: Colors.accent,
  },
  finalQuoteCard: {
    borderWidth: 2,
    borderColor: Colors.success,
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
    minWidth: '30%',
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
  quoteContent: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  quotePrice: {
    marginBottom: Spacing.md,
  },
  quoteLabel: {
    fontSize: Typography.size.sm,
    color: Colors.textSecondary,
  },
  quoteAmount: {
    fontSize: Typography.size.xxxl,
    fontWeight: Typography.weight.bold,
    color: Colors.accent,
    marginTop: Spacing.xs,
  },
  quoteRemarks: {
    fontSize: Typography.size.sm,
    color: Colors.textSecondary,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.md,
  },
  quoteActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    width: '100%',
  },
  quoteAcceptButton: {
    flex: 1,
  },
  quoteRejectButton: {
    flex: 1,
  },
  finalQuoteContent: {
    gap: Spacing.md,
  },
  finalQuoteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  finalQuoteLabel: {
    fontSize: Typography.size.md,
    color: Colors.textSecondary,
  },
  finalQuoteAmount: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    color: Colors.success,
  },
  quoteBreakdown: {
    gap: Spacing.xs,
    paddingTop: Spacing.sm,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
  },
  breakdownLabel: {
    fontSize: Typography.size.sm,
    color: Colors.textSecondary,
  },
  breakdownValue: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.textPrimary,
  },
  breakdownTotal: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  breakdownTotalValue: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
    color: Colors.primary,
  },
  customerDetails: {
    gap: Spacing.md,
  },
  supportGrid: {
    gap: Spacing.md,
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
  actionButtons: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  trackButton: {},
  newBookingButton: {},
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