export interface Vehicle {
  id: string;
  type: 'pickup' | 'mini_truck' | 'truck' | 'container';
  name: string;
  image?: any;
  capacity: string;
  capacityKg: number;
  category: string;
  wheels: number;
  lengthFt: number;
  priceLabel: string;
  price: number;
  priceMin: number;
  priceMax: number;
  bestFor: string[];
}

export interface BookingFormData {
  // Vehicle selection
  vehicle_type_required: string;

  // Route
  pickup_location: string;
  pickup_address: string;
  pickup_city: string;
  pickup_state: string;
  pickup_pincode: string;
  pickup_latitude?: number;
  pickup_longitude?: number;
  drop_location: string;
  drop_address: string;
  drop_city: string;
  drop_state: string;
  drop_pincode: string;
  drop_latitude?: number;
  drop_longitude?: number;
  distance_km?: number;

  // Schedule
  pickup_date: string;
  pickup_time: string;

  // Shipment
  goods_description: string;
  goods_type: string;
  goods_weight_kg: number | null;
  goods_volume: number | null;
  number_of_items: number;
  fragile: boolean;
  quantity_unit: string;
  weight_unit: string;
  special_instructions: string;

  // Customer
  customer_name: string;
  customer_mobile: string;
  customer_email?: string;
}

export interface PriceEstimate {
  distance_km: number;
  estimated_price_min: number;
  estimated_price_max: number;
  rate_per_km: number;
  vehicle_id: string;
}

export interface EnquiryResponse {
  success: boolean;
  message: string;
  data: {
    enquiryId: number;
    enquiry_id: number;
    enquiryNumber: string;
    enquiry_number: string;
    bookingId: number | null;
    booking_id: number | null;
    enquiry: Enquiry;
    enquiry_token: string | null;
    token_expires_at: string | null;
    redirect_to: string;
  };
}

export interface Enquiry {
  enquiry_id: number;
  enquiry_number: string;
  customer_name: string;
  customer_mobile: string;
  customer_email: string | null;
  pickup_location: string;
  pickup_address: string | null;
  pickup_city: string;
  pickup_state: string | null;
  pickup_pincode: string | null;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  drop_location: string;
  drop_address: string | null;
  drop_city: string;
  drop_state: string | null;
  drop_pincode: string | null;
  drop_latitude: number | null;
  drop_longitude: number | null;
  distance_km: number | null;
  requested_vehicle_id: number | null;
  requested_vehicle_name: string | null;
  material: string | null;
  quantity: number | null;
  quantity_unit: string | null;
  weight: number | null;
  weight_unit: string | null;
  goods_category: string | null;
  fragile: boolean;
  special_instructions: string | null;
  pickup_date: string;
  pickup_time: string;
  estimated_price_min: number | null;
  estimated_price_max: number | null;
  final_quoted_price: number | null;
  price_status: string;
  quote_remarks: string | null;
  quoted_at: string | null;
  status: EnquiryStatus;
  accepted_at: string | null;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
  booking?: {
    booking_id: number;
    booking_number: string;
    status: string;
  } | null;
  // Assignment fields (may be present in some API responses)
  assigned_vehicle_number?: string | null;
  assigned_vehicle_type?: string | null;
  assigned_driver_name?: string | null;
  assigned_driver_id?: number | null;
  vehicle_assigned_at?: string | null;
  driver_assigned_at?: string | null;
  events?: any[];
}

export type EnquiryStatus =
  | 'NEW'
  | 'UNDER_REVIEW'
  | 'ASSIGNMENT_PENDING'
  | 'VEHICLE_ASSIGNED'
  | 'DRIVER_ASSIGNED'
  | 'QUOTE_READY'
  | 'AWAITING_CUSTOMER_ACCEPTANCE'
  | 'CUSTOMER_ACCEPTED'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'REJECTED';

export interface QuoteResponse {
  success: boolean;
  data: {
    enquiry_id: number;
    enquiry_number: string;
    price_status: string;
    estimated_price_min: number | null;
    estimated_price_max: number | null;
    final_quoted_price: number | null;
    quote_remarks: string | null;
    quoted_at: string | null;
    quotation: Quotation | null;
    action_required: boolean;
    accepted_at: string | null;
    rejected_at: string | null;
    contact: CustomerCare;
  };
}

export interface Quotation {
  quotation_id: number;
  quotation_number: string;
  rate_basis: string;
  rate_per_km: number;
  distance_km: number;
  freight_amount: number;
  gst_percentage: number;
  gst_amount: number;
  additional_charges: number;
  total_amount: number;
  advance_percentage: number;
  advance_amount: number;
  balance_amount: number;
  payment_schedule: PaymentScheduleItem[];
  status: string;
  created_at: string;
  sent_at: string | null;
  accepted_at: string | null;
}

export interface PaymentScheduleItem {
  label: string;
  percentage: number;
  amount: number;
  due_date: string | null;
}

export interface CustomerCare {
  name: string;
  designation: string;
  phone: string;
  whatsapp: string;
  photo: string | null;
  hours: string;
  email: string | null;
  whatsappUrl: string;
  brandName: string;
}

export interface ApiError {
  success: false;
  message: string;
  errors?: Array<{ field: string; message: string }>;
  errorCode?: string;
}

export interface SessionData {
  sessionKey: string;
  enquiryTokens: Record<string, string>;
}

export interface BookingFormState {
  currentStep: number;
  formData: Partial<BookingFormData>;
  priceEstimate: PriceEstimate | null;
  isSubmitting: boolean;
  submitError: string | null;
  submittedEnquiry: EnquiryResponse | null;
}