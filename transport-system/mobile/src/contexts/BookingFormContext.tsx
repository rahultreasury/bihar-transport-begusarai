import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { BookingFormData, PriceEstimate, EnquiryResponse, Vehicle } from '@/types';
import { vehicleCatalogue, getVehicleById, getVehicleRate } from '@/constants/vehicleCatalogue';
import api from '@/services/api';

interface BookingFormContextType {
  // Form state
  currentStep: number;
  setCurrentStep: (step: number) => void;
  formData: Partial<BookingFormData>;
  updateFormData: (data: Partial<BookingFormData>) => void;
  resetForm: () => void;
  
  // Price estimation
  priceEstimate: PriceEstimate | null;
  fetchPriceEstimate: () => Promise<void>;
  
  // Submission
  isSubmitting: boolean;
  submitError: string | null;
  submittedEnquiry: EnquiryResponse | null;
  submitBooking: () => Promise<EnquiryResponse | null>;
  
  // Vehicle helpers
  selectedVehicle: Vehicle | undefined;
  availableVehicles: Vehicle[];
  
  // Validation
  validateCurrentStep: () => boolean;
  stepErrors: Record<string, string>;
  setFieldError: (field: string, error: string) => void;
  clearFieldError: (field: string) => void;
}

const BookingFormContext = createContext<BookingFormContextType | null>(null);

export const Provider = BookingFormContext.Provider;

const initialFormData: Partial<BookingFormData> = {
  vehicle_type_required: 'truck-17ft',
  pickup_city: 'Begusarai',
  pickup_state: 'Bihar',
  drop_state: 'Bihar',
  pickup_date: new Date().toISOString().split('T')[0],
  pickup_time: '10:00',
  goods_description: '',
  goods_type: '',
  goods_weight_kg: null,
  goods_volume: null,
  number_of_items: 1,
  fragile: false,
  quantity_unit: '',
  weight_unit: 'KG',
  special_instructions: '',
  customer_name: '',
  customer_mobile: '',
  customer_email: '',
};

export function BookingFormProvider({ children }: { children: ReactNode }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<Partial<BookingFormData>>(initialFormData);
  const [priceEstimate, setPriceEstimate] = useState<PriceEstimate | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedEnquiry, setSubmittedEnquiry] = useState<EnquiryResponse | null>(null);
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});

  const selectedVehicle = useMemo(
    () => getVehicleById(formData.vehicle_type_required || ''),
    [formData.vehicle_type_required]
  );

  const updateFormData = useCallback((data: Partial<BookingFormData>) => {
    setFormData((prev) => ({ ...prev, ...data }));
    // Clear errors for updated fields
    setStepErrors((prev) => {
      const newErrors = { ...prev };
      Object.keys(data).forEach((key) => delete newErrors[key]);
      return newErrors;
    });
  }, []);

  const resetForm = useCallback(() => {
    setCurrentStep(1);
    setFormData(initialFormData);
    setPriceEstimate(null);
    setSubmitError(null);
    setSubmittedEnquiry(null);
    setStepErrors({});
  }, []);

  const fetchPriceEstimate = useCallback(async () => {
    const { pickup_city, drop_city, vehicle_type_required } = formData;
    if (!pickup_city || !drop_city || !vehicle_type_required) return;

    try {
      const response = await api.calculatePrice({
        pickup_city,
        drop_city,
        vehicle_type: vehicle_type_required,
      });

      if (response.success) {
        const { distance_km, estimated_price, rate_per_km } = response.data;
        const vehicle = getVehicleById(vehicle_type_required);
        setPriceEstimate({
          distance_km,
          estimated_price_min: Math.round(estimated_price * 0.9),
          estimated_price_max: Math.round(estimated_price * 1.1),
          rate_per_km,
          vehicle_id: vehicle_type_required,
        });
      }
    } catch (error) {
      console.warn('Price estimation failed:', error);
      // Fallback to local calculation
      const vehicle = getVehicleById(vehicle_type_required);
      if (vehicle) {
        const distance = estimateDistance(pickup_city, drop_city);
        const rate = vehicle.price;
        setPriceEstimate({
          distance_km: distance,
          estimated_price_min: Math.round(distance * rate * 0.9),
          estimated_price_max: Math.round(distance * rate * 1.1),
          rate_per_km: rate,
          vehicle_id: vehicle_type_required,
        });
      }
    }
  }, [formData]);

  const submitBooking = useCallback(async (): Promise<EnquiryResponse | null> => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Prepare payload for the backend enquiry API
      const payload = {
        pickup_location: formData.pickup_location,
        pickup_address: formData.pickup_address,
        pickup_city: formData.pickup_city,
        pickup_state: formData.pickup_state,
        pickup_pincode: formData.pickup_pincode,
        pickup_latitude: formData.pickup_latitude,
        pickup_longitude: formData.pickup_longitude,
        drop_location: formData.drop_location,
        drop_address: formData.drop_address,
        drop_city: formData.drop_city,
        drop_state: formData.drop_state,
        drop_pincode: formData.drop_pincode,
        drop_latitude: formData.drop_latitude,
        drop_longitude: formData.drop_longitude,
        distance_km: priceEstimate?.distance_km,
        requested_vehicle_name: selectedVehicle?.name,
        material: formData.goods_description,
        quantity: formData.number_of_items,
        quantity_unit: formData.quantity_unit,
        weight: formData.goods_weight_kg,
        weight_unit: formData.weight_unit,
        goods_category: formData.goods_type,
        fragile: formData.fragile,
        special_instructions: formData.special_instructions,
        pickup_date: formData.pickup_date,
        pickup_time: formData.pickup_time,
        estimated_price_min: priceEstimate?.estimated_price_min,
        estimated_price_max: priceEstimate?.estimated_price_max,
        customer_name: formData.customer_name,
        customer_mobile: formData.customer_mobile,
        customer_email: formData.customer_email,
      };

      const response = await api.createEnquiry(payload);
      setSubmittedEnquiry(response);
      return response;
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Failed to submit booking. Please try again.';
      setSubmitError(message);
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, priceEstimate, selectedVehicle]);

  const validateCurrentStep = useCallback(() => {
    const errors: Record<string, string> = {};

    switch (currentStep) {
      case 1: // Vehicle selection
        if (!formData.vehicle_type_required) {
          errors.vehicle_type_required = 'Please select a vehicle';
        }
        break;
      case 2: // Route input
        if (!formData.pickup_location?.trim()) {
          errors.pickup_location = 'Pickup location is required';
        }
        if (!formData.drop_location?.trim()) {
          errors.drop_location = 'Drop location is required';
        }
        if (!formData.pickup_city?.trim()) {
          errors.pickup_city = 'Pickup city is required';
        }
        if (!formData.drop_city?.trim()) {
          errors.drop_city = 'Drop city is required';
        }
        if (!formData.pickup_date) {
          errors.pickup_date = 'Pickup date is required';
        }
        if (!formData.pickup_time) {
          errors.pickup_time = 'Pickup time is required';
        }
        // Check if pickup date is not in the past
        if (formData.pickup_date) {
          const pickupDate = new Date(formData.pickup_date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (pickupDate < today) {
            errors.pickup_date = 'Pickup date cannot be in the past';
          }
        }
        break;
      case 3: // Shipment details
        if (!formData.goods_description?.trim()) {
          errors.goods_description = 'Goods description is required';
        }
        break;
      case 4: // Review & Submit
        if (!formData.customer_name?.trim()) {
          errors.customer_name = 'Customer name is required';
        }
        if (!formData.customer_mobile?.trim()) {
          errors.customer_mobile = 'Mobile number is required';
        } else if (!/^[6-9]\d{9}$/.test(formData.customer_mobile.replace(/\D/g, '').slice(-10))) {
          errors.customer_mobile = 'Enter a valid 10-digit Indian mobile number';
        }
        break;
    }

    setStepErrors(errors);
    return Object.keys(errors).length === 0;
  }, [currentStep, formData]);

  const setFieldError = useCallback((field: string, error: string) => {
    setStepErrors((prev) => ({ ...prev, [field]: error }));
  }, []);

  const clearFieldError = useCallback((field: string) => {
    setStepErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[field];
      return newErrors;
    });
  }, []);

  const value = useMemo<BookingFormContextType>(
    () => ({
      currentStep,
      setCurrentStep,
      formData,
      updateFormData,
      resetForm,
      priceEstimate,
      fetchPriceEstimate,
      isSubmitting,
      submitError,
      submittedEnquiry,
      submitBooking,
      selectedVehicle,
      availableVehicles: vehicleCatalogue,
      validateCurrentStep,
      stepErrors,
      setFieldError,
      clearFieldError,
    }),
    [
      currentStep,
      formData,
      priceEstimate,
      isSubmitting,
      submitError,
      submittedEnquiry,
      selectedVehicle,
      validateCurrentStep,
      stepErrors,
    ]
  );

  return (
    <BookingFormContext.Provider value={value}>
      {children}
    </BookingFormContext.Provider>
  );
}

export function useBookingForm() {
  const context = useContext(BookingFormContext);
  if (!context) {
    throw new Error('useBookingForm must be used within a BookingFormProvider');
  }
  return context;
}

// Simple distance estimation (same as backend)
function estimateDistance(fromCity: string, toCity: string): number {
  const cityDistances: Record<string, number> = {
    'Begusarai-Patna': 180,
    'Patna-Begusarai': 180,
    'Begusarai-Muzaffarpur': 90,
    'Muzaffarpur-Begusarai': 90,
    'Patna-Muzaffarpur': 80,
    'Muzaffarpur-Patna': 80,
    'Begusarai-Gaya': 140,
    'Gaya-Begusarai': 140,
    'Patna-Gaya': 110,
    'Gaya-Patna': 110,
    'Muzaffarpur-Darbhanga': 45,
    'Darbhanga-Muzaffarpur': 45,
  };
  const key = `${fromCity}-${toCity}`;
  return cityDistances[key] || 100;
}