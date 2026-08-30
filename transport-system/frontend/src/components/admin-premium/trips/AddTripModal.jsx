import React from 'react';
import TripWizard from './TripWizard';

function AddTripModal({ isOpen, onClose, onSaved, editingTrip }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div className="absolute inset-y-0 right-0 w-full max-w-3xl bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-border/60 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">
              {editingTrip ? 'Edit Trip' : 'Create New Trip'}
            </h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-hover/60 rounded-xl transition-colors"
            >
              <svg className="w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          <TripWizard
            onComplete={onSaved}
            onCancel={onClose}
            editingTrip={editingTrip}
          />
        </div>
      </div>
    </div>
  );
}

export default AddTripModal;
