import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UserRound,
  Truck,
  Phone,
  Star,
  Package,
  ShieldCheck,
  X,
  BadgeCheck,
  Gauge,
  MapPin,
  ClipboardList,
  ChevronRight,
  ChevronLeft,
  AlertCircle,
  CheckCircle2,
  ArrowUpRight,
  Clock,
} from 'lucide-react';
import StatusBadge from './StatusBadge';
import { adminAPI } from '../../../services/api';

/* ===================================================================
   THEME CONSTANTS - Bihar Transport Branding
   =================================================================== */
const ORANGE = {
  gradient: 'from-amber-500 to-orange-600',
  light: 'bg-amber-50',
  border: 'border-amber-500',
  text: 'text-amber-600',
  bg: 'bg-amber-500',
  glow: '0 0 20px rgba(245,158,11,0.3)',
  bgSoft: 'bg-amber-500/10',
  ring: 'ring-amber-500/30',
};

const DARK_NAVY = 'bg-[#1e3a5f]';
const SUCCESS_GREEN = 'bg-emerald-500';

/* ===================================================================
   UTILITY COMPONENTS
   =================================================================== */

const InfoRow = React.memo(function InfoRow({ label, value }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-sm font-semibold text-text break-words">{value || 'Not Available'}</div>
    </div>
  );
});

const SectionCard = React.memo(function SectionCard({ title, children, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl overflow-hidden ${className}`}
    >
      <div className="px-5 py-3.5 border-b border-border/40">
        <span className="text-sm font-bold tracking-tight">{title}</span>
      </div>
      <div className="px-5 py-4">
        {children}
      </div>
    </motion.div>
  );
});

/* ===================================================================
   PREMIUM EMPTY STATE - Illustrated placeholder for unassigned items
   =================================================================== */

function EmptyAssignmentState({
  type,
  onAssign,
  disabled = false,
}) {
  const isDriver = type === 'driver';
  const Icon = isDriver ? UserRound : Truck;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center justify-center py-8 px-4 border-2 border-dashed border-border/60 rounded-xl bg-card/20"
    >
      <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-amber-500/60" strokeWidth={1.5} />
      </div>
      <p className="text-sm font-semibold text-text mb-1">
        {isDriver ? 'No Driver Assigned' : 'No Vehicle Assigned'}
      </p>
      <p className="text-xs text-muted text-center mb-4 max-w-[180px]">
        {isDriver
          ? 'Assign a driver to start tracking this delivery'
          : 'Assign a vehicle to proceed with this booking'}
      </p>
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onAssign}
        disabled={disabled}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/20"
      >
        <Icon className="w-4 h-4" strokeWidth={2.5} />
        Assign {isDriver ? 'Driver' : 'Vehicle'}
      </motion.button>
    </motion.div>
  );
}

/* ===================================================================
   PREMIUM PROFILE CARD - For assigned Driver/Vehicle in drawer
   =================================================================== */

function DriverProfileCard({
  booking,
  onAssign,
  onReplace,
  canAssign,
}) {
  const driverName = `${booking.driver_first_name || ''} ${booking.driver_last_name || ''}`.trim();
  const initials = driverName
    ? driverName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : 'DR';
  const isAssigned = !!booking.driver_id;
  const rating = booking.driver_rating || booking.rating;
  const deliveries = booking.driver_total_deliveries || booking.total_deliveries;

  if (!isAssigned) {
    return <EmptyAssignmentState type="driver" onAssign={onAssign} disabled={!canAssign} />;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.05 }}
      className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl overflow-hidden h-full flex flex-col"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center">
          <UserRound className="w-3.5 h-3.5 text-amber-600" strokeWidth={2.5} />
        </div>
        <span className="text-xs font-bold uppercase tracking-wider text-muted">Driver</span>
      </div>

      {/* Center: Avatar + Name + Phone */}
      <div className="px-4 py-4 flex flex-col items-center text-center border-b border-border/30">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
          className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-lg mb-3 shadow-lg shadow-amber-500/20"
        >
          {initials}
        </motion.div>
        <h4 className="text-sm font-bold text-text">{driverName}</h4>
        {booking.driver_phone && (
          <div className="flex items-center gap-1.5 mt-1 text-xs text-muted">
            <Phone className="w-3 h-3" strokeWidth={1.5} />
            {booking.driver_phone}
          </div>
        )}
      </div>

      {/* Bottom: Stats + Status + Actions */}
      <div className="px-4 py-3 flex-1 flex flex-col justify-between">
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="rounded-lg bg-amber-500/5 border border-amber-500/10 px-2.5 py-2 text-center">
            <div className="flex items-center justify-center gap-1 text-amber-600 mb-0.5">
              <Star className="w-3 h-3 fill-current" strokeWidth={0} />
              <span className="text-xs font-bold">{rating ?? '—'}</span>
            </div>
            <div className="text-[10px] text-muted uppercase tracking-wider">Rating</div>
          </div>
          <div className="rounded-lg bg-amber-500/5 border border-amber-500/10 px-2.5 py-2 text-center">
            <div className="flex items-center justify-center gap-1 text-amber-600 mb-0.5">
              <Package className="w-3 h-3" strokeWidth={2} />
              <span className="text-xs font-bold">{deliveries ?? 0}</span>
            </div>
            <div className="text-[10px] text-muted uppercase tracking-wider">Deliveries</div>
          </div>
        </div>

        <div className="flex items-center justify-center mb-3">
          <StatusBadge status="driver_assigned" size="sm" />
        </div>

        <div className="flex gap-2">
          {canAssign && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onReplace}
              className="flex-1 px-3 py-2 rounded-xl border border-amber-500/30 text-amber-600 text-xs font-semibold hover:bg-amber-500/5 transition"
            >
              Replace Driver
            </motion.button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function VehicleProfileCard({
  booking,
  onAssign,
  onReplace,
  canAssign,
}) {
  const vehicleName = booking.vehicle_name || '—';
  const vehicleNumber = booking.vehicle_number || '—';
  const capacity = booking.vehicle_capacity_kg || booking.capacity_kg;
  const vehicleType = booking.vehicle_type_required
    ? booking.vehicle_type_required.replace(/_/g, ' ')
    : booking.vehicle_type
      ? booking.vehicle_type.replace(/_/g, ' ')
      : null;
  const isAssigned = !!booking.vehicle_id;

  if (!isAssigned) {
    return <EmptyAssignmentState type="vehicle" onAssign={onAssign} disabled={!canAssign} />;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl overflow-hidden h-full flex flex-col"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-violet-500/10 flex items-center justify-center">
          <Truck className="w-3.5 h-3.5 text-violet-600" strokeWidth={2.5} />
        </div>
        <span className="text-xs font-bold uppercase tracking-wider text-muted">Vehicle</span>
      </div>

      {/* Center: Vehicle Name + Registration */}
      <div className="px-4 py-4 flex flex-col items-center text-center border-b border-border/30">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, delay: 0.15 }}
          className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white mb-3 shadow-lg shadow-violet-500/20"
        >
          <Truck className="w-7 h-7" strokeWidth={1.5} />
        </motion.div>
        <h4 className="text-sm font-bold text-text">{vehicleName}</h4>
        <div className="text-xs text-muted mt-0.5 font-mono">{vehicleNumber}</div>
      </div>

      {/* Bottom: Stats + Status + Actions */}
      <div className="px-4 py-3 flex-1 flex flex-col justify-between">
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="rounded-lg bg-violet-500/5 border border-violet-500/10 px-2.5 py-2 text-center">
            <div className="flex items-center justify-center gap-1 text-violet-600 mb-0.5">
              <Gauge className="w-3 h-3" strokeWidth={2} />
              <span className="text-xs font-bold">{capacity ? `${capacity} kg` : '—'}</span>
            </div>
            <div className="text-[10px] text-muted uppercase tracking-wider">Capacity</div>
          </div>
          <div className="rounded-lg bg-violet-500/5 border border-violet-500/10 px-2.5 py-2 text-center">
            <div className="flex items-center justify-center gap-1 text-violet-600 mb-0.5">
              <ClipboardList className="w-3 h-3" strokeWidth={2} />
              <span className="text-xs font-bold">{vehicleType || '—'}</span>
            </div>
            <div className="text-[10px] text-muted uppercase tracking-wider">Type</div>
          </div>
        </div>

        <div className="flex items-center justify-center mb-3">
          <StatusBadge status="driver_assigned" size="sm" />
        </div>

        <div className="flex gap-2">
          {canAssign && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onReplace}
              className="flex-1 px-3 py-2 rounded-xl border border-violet-500/30 text-violet-600 text-xs font-semibold hover:bg-violet-500/5 transition"
            >
              Replace Vehicle
            </motion.button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ===================================================================
   DRIVER MODAL - Premium Uber Freight style selection
   =================================================================== */

const DriverCard = React.memo(function DriverCard({
  driver,
  isSelected,
  onSelect,
  index,
}) {
  const name = `${driver.first_name || ''} ${driver.last_name || ''}`.trim() || `Driver #${driver.driver_id}`;
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const rating = driver.rating;
  const deliveries = driver.total_deliveries ?? driver.total_deliveries;
  const phone = driver.phone || '—';
  const vehicleType = driver.vehicle_type ? driver.vehicle_type.replace(/_/g, ' ') : null;
  const isAvailable = driver.status === 'available' || driver.is_available === 1 || driver.is_available === true;

  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onSelect(driver.driver_id)}
      className={`w-full text-left p-4 rounded-2xl border-2 transition-all duration-200 ${
        isSelected
          ? 'border-amber-500 bg-amber-500/5 shadow-lg'
          : 'border-border/60 bg-card/40 hover:border-amber-500/40 hover:bg-amber-500/[0.02]'
      }`}
      style={isSelected ? { boxShadow: '0 0 24px rgba(245,158,11,0.15)' } : {}}
      aria-label={`Select driver ${name}`}
      aria-selected={isSelected}
    >
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="relative shrink-0">
          <div className={`w-14 h-14 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-lg shadow-md ${
            isSelected ? 'shadow-amber-500/30' : ''
          }`}>
            {initials}
          </div>
          {isAvailable && (
            <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center">
              <ShieldCheck className="w-3 h-3 text-white" strokeWidth={3} />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {/* Name + Badge */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-text truncate">{name}</span>
            <BadgeCheck className="w-4 h-4 text-amber-500 shrink-0" strokeWidth={2.5} />
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-md bg-amber-500/10 flex items-center justify-center shrink-0">
                <Star className="w-3 h-3 text-amber-600 fill-current" strokeWidth={0} />
              </div>
              <span className="text-xs text-muted">
                <span className="font-semibold text-text">{rating ?? '—'}</span> Rating
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-md bg-amber-500/10 flex items-center justify-center shrink-0">
                <Package className="w-3 h-3 text-amber-600" strokeWidth={2} />
              </div>
              <span className="text-xs text-muted">
                <span className="font-semibold text-text">{deliveries ?? 0}</span> Deliveries
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-md bg-amber-500/10 flex items-center justify-center shrink-0">
                <Phone className="w-3 h-3 text-amber-600" strokeWidth={2} />
              </div>
              <span className="text-xs text-muted truncate">{phone}</span>
            </div>
          </div>

          {/* Bottom Row: Availability + Vehicle Type */}
          <div className="flex items-center gap-2 mt-3">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
              isAvailable
                ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                : 'bg-gray-500/10 text-gray-500 border border-gray-500/20'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${isAvailable ? 'bg-emerald-500' : 'bg-gray-400'}`} />
              {isAvailable ? 'Available' : 'Occupied'}
            </span>
            {vehicleType && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                <Truck className="w-2.5 h-2.5" strokeWidth={2.5} />
                {vehicleType}
              </span>
            )}
          </div>
        </div>

        {/* Selection Indicator */}
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-1 transition-all duration-200 ${
          isSelected
            ? 'border-amber-500 bg-amber-500'
            : 'border-border'
        }`}>
          {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
        </div>
      </div>
    </motion.button>
  );
});

/* ===================================================================
   VEHICLE MODAL - Premium matching Driver Modal quality
   =================================================================== */

const VehicleCard = React.memo(function VehicleCard({
  vehicle,
  isSelected,
  onSelect,
  index,
}) {
  const name = vehicle.vehicle_name || vehicle.vehicle_number || `Vehicle #${vehicle.vehicle_id}`;
  const regNumber = vehicle.vehicle_number || '—';
  const capacity = vehicle.capacity_kg ? `${vehicle.capacity_kg} kg` : '—';
  const vehicleType = vehicle.vehicle_type ? vehicle.vehicle_type.replace(/_/g, ' ') : '—';
  const isAvailable = vehicle.is_available === 1 || vehicle.is_available === true;
  const currentStatus = vehicle.vehicle_status || vehicle.status || 'available';

  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onSelect(vehicle.vehicle_id)}
      className={`w-full text-left p-4 rounded-2xl border-2 transition-all duration-200 ${
        isSelected
          ? 'border-violet-500 bg-violet-500/5 shadow-lg'
          : 'border-border/60 bg-card/40 hover:border-violet-500/40 hover:bg-violet-500/[0.02]'
      }`}
      style={isSelected ? { boxShadow: '0 0 24px rgba(139,92,246,0.15)' } : {}}
      aria-label={`Select vehicle ${name}`}
      aria-selected={isSelected}
    >
      <div className="flex items-start gap-4">
        {/* Vehicle Icon */}
        <div className="relative shrink-0">
          <div className={`w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white shadow-md ${
            isSelected ? 'shadow-violet-500/30' : ''
          }`}>
            <Truck className="w-7 h-7" strokeWidth={1.5} />
          </div>
          {isAvailable && (
            <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center">
              <CheckCircle2 className="w-3 h-3 text-white" strokeWidth={3} />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {/* Name */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-text truncate">{name}</span>
            <BadgeCheck className="w-4 h-4 text-violet-500 shrink-0" strokeWidth={2.5} />
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-md bg-violet-500/10 flex items-center justify-center shrink-0">
                <MapPin className="w-3 h-3 text-violet-600" strokeWidth={2} />
              </div>
              <span className="text-xs text-muted">
                <span className="font-semibold text-text">{regNumber}</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-md bg-violet-500/10 flex items-center justify-center shrink-0">
                <Gauge className="w-3 h-3 text-violet-600" strokeWidth={2} />
              </div>
              <span className="text-xs text-muted">
                <span className="font-semibold text-text">{capacity}</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-md bg-violet-500/10 flex items-center justify-center shrink-0">
                <ClipboardList className="w-3 h-3 text-violet-600" strokeWidth={2} />
              </div>
              <span className="text-xs text-muted">
                <span className="font-semibold text-text">{vehicleType}</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-md bg-violet-500/10 flex items-center justify-center shrink-0">
                <Clock className="w-3 h-3 text-violet-600" strokeWidth={2} />
              </div>
              <span className="text-xs text-muted capitalize">
                <span className="font-semibold text-text">{currentStatus.replace(/_/g, ' ')}</span>
              </span>
            </div>
          </div>

          {/* Bottom Row: Availability Badge */}
          <div className="flex items-center gap-2 mt-3">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
              isAvailable
                ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                : 'bg-gray-500/10 text-gray-500 border border-gray-500/20'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${isAvailable ? 'bg-emerald-500' : 'bg-gray-400'}`} />
              {isAvailable ? 'Available' : 'Unavailable'}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/10 text-violet-600 border border-violet-500/20">
              <Truck className="w-2.5 h-2.5" strokeWidth={2.5} />
              {vehicleType}
            </span>
          </div>
        </div>

        {/* Selection Indicator */}
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-1 transition-all duration-200 ${
          isSelected
            ? 'border-violet-500 bg-violet-500'
            : 'border-border'
        }`}>
          {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
        </div>
      </div>
    </motion.button>
  );
});

/* ===================================================================
   ASSIGN MODAL SHELL - Shared by Driver & Vehicle modals
   =================================================================== */

const AssignModalShell = React.memo(function AssignModalShell({
  isOpen,
  onClose,
  title,
  subtitle,
  icon: Icon,
  iconBg,
  accentColor,
  loading,
  loadingMessage,
  items,
  children,
  error,
  success,
  onConfirm,
  confirmDisabled,
  confirmLoading,
  confirmLabel,
  confirmLoadingLabel,
  onCancel,
}) {
  if (!isOpen) return null;

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => { if (!confirmLoading) onClose(); }}
        aria-hidden="true"
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className={`relative bg-white dark:bg-gray-950 border border-border/60 overflow-hidden flex flex-col ${
          isMobile
            ? 'fixed inset-0 w-full h-full rounded-none'
            : 'w-full max-w-xl rounded-2xl shadow-2xl max-h-[90vh]'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Header */}
        <div className="shrink-0 px-5 py-4 border-b border-border/60 flex items-center justify-between bg-white/50 dark:bg-gray-950/50 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center`}>
              <Icon className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h3 className="text-base font-bold text-text">{title}</h3>
              <p className="text-xs text-muted mt-0.5">{subtitle}</p>
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onClose}
            disabled={confirmLoading}
            className="h-9 w-9 rounded-xl border border-border/60 flex items-center justify-center hover:bg-hover/60 transition disabled:opacity-50 shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </motion.button>
        </div>

        {/* Body */}
        <div className={`flex-1 ${isMobile ? 'overflow-y-auto' : 'overflow-y-auto max-h-[50vh]'}`}>
          <div className="p-4 sm:p-5">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse">
                    <div className="h-20 rounded-2xl bg-gray-100 dark:bg-gray-800/50" />
                  </div>
                ))}
                <div className="flex items-center justify-center py-3">
                  <div className={`h-5 w-5 border-2 border-t-transparent rounded-full animate-spin ${accentColor === 'amber' ? 'border-amber-400' : 'border-violet-400'}`} />
                  <span className="ml-3 text-sm text-muted">{loadingMessage}</span>
                </div>
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-10">
                <div className={`w-16 h-16 rounded-2xl ${iconBg} flex items-center justify-center mx-auto mb-4`}>
                  <Icon className="w-8 h-8 text-white/80" strokeWidth={1.5} />
                </div>
                <p className="text-sm font-semibold text-text">No available {title.toLowerCase().split(' ')[0]}s</p>
                <p className="text-xs text-muted mt-1 max-w-[240px] mx-auto">
                  All {title.toLowerCase().split(' ')[0]}s are currently assigned to other bookings
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {children}
              </div>
            )}
          </div>
        </div>

        {/* Error / Success Messages */}
        <div className="shrink-0 px-5">
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mb-3 rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 px-4 py-2.5 flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" strokeWidth={2} />
                <span className="text-sm text-red-700 dark:text-red-400">{error}</span>
              </motion.div>
            )}
            {success && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/20 px-4 py-2.5 flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" strokeWidth={2} />
                <span className="text-sm text-emerald-700 dark:text-emerald-400">{success}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer Actions */}
        <div className="shrink-0 px-5 py-4 border-t border-border/60 bg-white/50 dark:bg-gray-950/50 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onCancel || onClose}
              disabled={confirmLoading}
              className="flex-1 px-4 py-2.5 rounded-xl border border-border/60 text-text font-semibold text-sm hover:bg-hover/60 transition disabled:opacity-50"
            >
              Cancel
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onConfirm}
              disabled={confirmDisabled || confirmLoading || loading}
              className={`flex-1 px-4 py-2.5 rounded-xl text-white font-semibold text-sm transition disabled:opacity-50 flex items-center justify-center gap-2 ${
                accentColor === 'amber'
                  ? 'bg-amber-500 hover:bg-amber-600 shadow-lg shadow-amber-500/20'
                  : 'bg-violet-500 hover:bg-violet-600 shadow-lg shadow-violet-500/20'
              }`}
            >
              {confirmLoading ? (
                <>
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {confirmLoadingLabel}
                </>
              ) : (
                <>
                  <Icon className="w-4 h-4" strokeWidth={2.5} />
                  {confirmLabel}
                </>
              )}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </div>
  );
});

/* ===================================================================
   BOOKING DETAILS DRAWER - Main Component
   =================================================================== */

function BookingDetailsDrawer({ booking, isOpen, onClose, onBookingUpdated }) {
  const drawerRef = useRef(null);
  const previousActiveElement = useRef(null);

  // Assign Driver modal state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [availableDrivers, setAvailableDrivers] = useState([]);
  const [selectedDriverId, setSelectedDriverId] = useState(null);
  const [assigningDriver, setAssigningDriver] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [assignSuccess, setAssignSuccess] = useState('');
  const [loadingDrivers, setLoadingDrivers] = useState(false);

  // Assign Vehicle modal state
  const [showAssignVehicleModal, setShowAssignVehicleModal] = useState(false);
  const [availableVehicles, setAvailableVehicles] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [assigningVehicle, setAssigningVehicle] = useState(false);
  const [assignVehicleError, setAssignVehicleError] = useState('');
  const [assignVehicleSuccess, setAssignVehicleSuccess] = useState('');
  const [loadingVehicles, setLoadingVehicles] = useState(false);

  // Trap focus
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement;
      setTimeout(() => {
        drawerRef.current?.focus();
      }, 100);
    } else {
      previousActiveElement.current?.focus();
    }
  }, [isOpen]);

  // Handle ESC
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        if (showAssignModal) {
          setShowAssignModal(false);
        } else if (showAssignVehicleModal) {
          setShowAssignVehicleModal(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose, showAssignModal, showAssignVehicleModal]);

  // Lock body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  const canAssignDriver = useCallback(() => {
    if (!booking) return false;
    if (['cancelled', 'completed', 'delivered'].includes(booking.status)) return false;
    return true;
  }, [booking]);

  const canAssignVehicle = useCallback(() => {
    if (!booking) return false;
    if (['cancelled', 'completed', 'delivered'].includes(booking.status)) return false;
    return true;
  }, [booking]);

  const handleOpenAssignModal = useCallback(async () => {
    setAssignError('');
    setAssignSuccess('');
    setSelectedDriverId(null);
    setLoadingDrivers(true);
    setShowAssignModal(true);
    try {
      const response = await adminAPI.getAvailableDrivers();
      if (response.data?.success) {
        setAvailableDrivers(response.data.data || []);
      } else {
        setAssignError('Failed to load available drivers');
      }
    } catch (err) {
      setAssignError('Failed to load available drivers');
      console.error('Error loading drivers:', err);
    } finally {
      setLoadingDrivers(false);
    }
  }, []);

  const handleAssignDriver = useCallback(async () => {
    if (!selectedDriverId || !booking) return;
    setAssigningDriver(true);
    setAssignError('');
    setAssignSuccess('');
    try {
      const response = await adminAPI.assignDriver(booking.booking_id, selectedDriverId);
      if (response.data?.success) {
        setAssignSuccess('Driver assigned successfully');
        if (onBookingUpdated) {
          onBookingUpdated(booking.booking_id);
        }
        setTimeout(() => {
          setShowAssignModal(false);
        }, 800);
      } else {
        setAssignError(response.data?.message || 'Failed to assign driver');
      }
    } catch (err) {
      setAssignError(err?.response?.data?.message || err?.message || 'Failed to assign driver');
    } finally {
      setAssigningDriver(false);
    }
  }, [selectedDriverId, booking, onBookingUpdated]);

  const handleOpenAssignVehicleModal = useCallback(async () => {
    setAssignVehicleError('');
    setAssignVehicleSuccess('');
    setSelectedVehicleId(null);
    setLoadingVehicles(true);
    setShowAssignVehicleModal(true);
    try {
      const response = await adminAPI.getVehicles({ limit: 100 });
      if (response.data?.success) {
        const allVehicles = response.data.data || [];
        const available = allVehicles.filter(v => v.is_available === 1 || v.is_available === true);
        setAvailableVehicles(available);
      } else {
        setAssignVehicleError('Failed to load available vehicles');
      }
    } catch (err) {
      setAssignVehicleError('Failed to load available vehicles');
      console.error('Error loading vehicles:', err);
    } finally {
      setLoadingVehicles(false);
    }
  }, []);

  const handleAssignVehicle = useCallback(async () => {
    if (!selectedVehicleId || !booking) return;
    setAssigningVehicle(true);
    setAssignVehicleError('');
    setAssignVehicleSuccess('');
    try {
      const response = await adminAPI.assignVehicle(booking.booking_id, selectedVehicleId);
      if (response.data?.success) {
        setAssignVehicleSuccess('Vehicle assigned successfully');
        if (onBookingUpdated) {
          onBookingUpdated(booking.booking_id);
        }
        setTimeout(() => {
          setShowAssignVehicleModal(false);
        }, 800);
      } else {
        setAssignVehicleError(response.data?.message || 'Failed to assign vehicle');
      }
    } catch (err) {
      setAssignVehicleError(err?.response?.data?.message || err?.message || 'Failed to assign vehicle');
    } finally {
      setAssigningVehicle(false);
    }
  }, [selectedVehicleId, booking, onBookingUpdated]);

  if (!booking) return null;

  const customerName = `${booking.customer_first_name || ''} ${booking.customer_last_name || ''}`.trim() || '—';
  const distance = booking.estimated_distance_km ? `${booking.estimated_distance_km} km` : '—';
  const price = booking.final_price
    ? `\u20B9${Number(booking.final_price).toLocaleString()}`
    : booking.estimated_price
      ? `\u20B9${Number(booking.estimated_price).toLocaleString()} (est.)`
      : '—';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
            onClick={() => { if (!showAssignModal && !showAssignVehicleModal) onClose(); }}
            aria-hidden="true"
          />

          {/* Drawer */}
          <motion.div
            ref={drawerRef}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-full max-w-[580px] bg-surface border-l border-border/60 shadow-2xl z-50 overflow-hidden flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-label="Booking Details"
            tabIndex={-1}
          >
            {/* Header */}
            <div className="shrink-0 px-6 py-5 border-b border-border/60 flex items-center justify-between bg-header/30 backdrop-blur-xl">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold tracking-tight truncate">
                    {booking.booking_reference || 'Booking Details'}
                  </h2>
                  {booking.status && <StatusBadge status={booking.status} size="sm" />}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  Booking ID: #{booking.booking_id}
                </div>
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={onClose}
                className="h-10 w-10 rounded-xl border border-border/60 bg-card/40 flex items-center justify-center hover:bg-hover/60 transition ml-3 shrink-0"
                aria-label="Close drawer"
              >
                <X className="w-5 h-5" strokeWidth={2} />
              </motion.button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

              {/* 1. Customer Information */}
              <SectionCard title="Customer Information">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <InfoRow label="Customer Name" value={customerName} />
                  <InfoRow label="Mobile Number" value={booking.customer_phone} />
                  <InfoRow label="Email" value={booking.customer_email} />
                </div>
              </SectionCard>

              {/* 2. Booking Information */}
              <SectionCard title="Booking Information">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <InfoRow label="Booking Reference" value={booking.booking_reference} />
                  <InfoRow label="Booking Date &amp; Time" value={booking.created_at ? new Date(booking.created_at).toLocaleString('en-IN') : '—'} />
                  <InfoRow label="Pickup Location" value={booking.pickup_location || booking.pickup_address || booking.pickup_city} />
                  <InfoRow label="Drop Location" value={booking.drop_location || booking.drop_address || booking.drop_city} />
                  <InfoRow label="Goods Type" value={booking.goods_type || '—'} />
                  <InfoRow label="Pickup Date" value={booking.pickup_date ? new Date(booking.pickup_date).toLocaleDateString('en-IN') + (booking.pickup_time ? ` ${booking.pickup_time}` : '') : '—'} />
                  <InfoRow label="Distance" value={distance} />
                  <InfoRow label="Price" value={price} />
                </div>
              </SectionCard>

              {/* 3. ASSIGNMENT - Premium Redesign */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl overflow-hidden"
              >
                <div className="px-5 py-3.5 border-b border-border/40 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <ClipboardList className="w-3.5 h-3.5 text-amber-600" strokeWidth={2.5} />
                  </div>
                  <span className="text-sm font-bold tracking-tight">Assignment</span>
                </div>
                <div className="px-4 py-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Driver Profile Card */}
                    <DriverProfileCard
                      booking={booking}
                      onAssign={handleOpenAssignModal}
                      onReplace={handleOpenAssignModal}
                      canAssign={canAssignDriver()}
                    />

                    {/* Vehicle Profile Card */}
                    <VehicleProfileCard
                      booking={booking}
                      onAssign={handleOpenAssignVehicleModal}
                      onReplace={handleOpenAssignVehicleModal}
                      canAssign={canAssignVehicle()}
                    />
                  </div>
                </div>
              </motion.div>

              {/* 4. Booking Status */}
              <SectionCard title="Booking Status">
                <div className="flex items-center gap-3">
                  <StatusBadge status={booking.status} size="lg" />
                  <div className="text-sm text-muted">
                    {booking.status === 'pending' && 'Awaiting confirmation'}
                    {booking.status === 'confirmed' && 'Booking confirmed'}
                    {booking.status === 'driver_assigned' && 'Driver has been assigned'}
                    {booking.status === 'pickup_completed' && 'Goods picked up'}
                    {booking.status === 'in_transit' && 'Goods in transit'}
                    {booking.status === 'delivered' && 'Goods delivered'}
                    {booking.status === 'cancelled' && 'Booking was cancelled'}
                    {booking.status === 'completed' && 'Booking completed'}
                  </div>
                </div>
                {booking.delivery_current_status && (
                  <div className="mt-3 pt-3 border-t border-border/40">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      <InfoRow label="Delivery Status" value={booking.delivery_current_status.replace(/_/g, ' ')} />
                      <InfoRow label="Status Description" value={booking.delivery_status_description || '—'} />
                    </div>
                  </div>
                )}
              </SectionCard>

            </div>
          </motion.div>

          {/* ASSIGN DRIVER MODAL */}
          <AnimatePresence>
            {showAssignModal && (
              <AssignModalShell
                isOpen={showAssignModal}
                onClose={() => setShowAssignModal(false)}
                title="Assign Driver"
                subtitle="Select an available driver for this booking"
                icon={UserRound}
                iconBg="bg-gradient-to-br from-amber-500 to-orange-600"
                accentColor="amber"
                loading={loadingDrivers}
                loadingMessage="Loading available drivers..."
                items={availableDrivers}
                error={assignError}
                success={assignSuccess}
                onConfirm={handleAssignDriver}
                confirmDisabled={!selectedDriverId || assigningDriver || loadingDrivers}
                confirmLoading={assigningDriver}
                confirmLabel="Assign Driver"
                confirmLoadingLabel="Assigning..."
                onCancel={() => setShowAssignModal(false)}
              >
                <AnimatePresence>
                  {availableDrivers.map((driver, idx) => (
                    <DriverCard
                      key={driver.driver_id}
                      driver={driver}
                      isSelected={selectedDriverId === driver.driver_id}
                      onSelect={setSelectedDriverId}
                      index={idx}
                    />
                  ))}
                </AnimatePresence>
              </AssignModalShell>
            )}
          </AnimatePresence>

          {/* ASSIGN VEHICLE MODAL */}
          <AnimatePresence>
            {showAssignVehicleModal && (
              <AssignModalShell
                isOpen={showAssignVehicleModal}
                onClose={() => setShowAssignVehicleModal(false)}
                title="Assign Vehicle"
                subtitle="Select an available vehicle for this booking"
                icon={Truck}
                iconBg="bg-gradient-to-br from-violet-500 to-purple-600"
                accentColor="violet"
                loading={loadingVehicles}
                loadingMessage="Loading available vehicles..."
                items={availableVehicles}
                error={assignVehicleError}
                success={assignVehicleSuccess}
                onConfirm={handleAssignVehicle}
                confirmDisabled={!selectedVehicleId || assigningVehicle || loadingVehicles}
                confirmLoading={assigningVehicle}
                confirmLabel="Assign Vehicle"
                confirmLoadingLabel="Assigning..."
                onCancel={() => setShowAssignVehicleModal(false)}
              >
                <AnimatePresence>
                  {availableVehicles.map((vehicle, idx) => (
                    <VehicleCard
                      key={vehicle.vehicle_id}
                      vehicle={vehicle}
                      isSelected={selectedVehicleId === vehicle.vehicle_id}
                      onSelect={setSelectedVehicleId}
                      index={idx}
                    />
                  ))}
                </AnimatePresence>
              </AssignModalShell>
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>
  );
}

export default BookingDetailsDrawer;

