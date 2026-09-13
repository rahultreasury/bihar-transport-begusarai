import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import TripWizard from '../components/admin-premium/trips/TripWizard';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'bookings', label: 'Bookings', icon: '⟐' },
  { key: 'trips', label: 'Trips', icon: '🚛' },
  { key: 'owners', label: 'Transport Owners', icon: '⧉' },
  { key: 'vehicles', label: 'Vehicles', icon: '🚛' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'analytics', label: 'Analytics', icon: '◷' },
  { key: 'ai', label: 'AI Insights', icon: '✦' }
];

const WIZARD_STEPS = [
  { key: 'trip', label: 'Trip', description: 'Trip Details' },
  { key: 'resources', label: 'Resources', description: 'Vehicle & Driver' },
  { key: 'advance', label: 'Advance', description: 'Money Paid' },
  { key: 'review', label: 'Review', description: 'Confirm Trip' },
];

function AdminCreateTrip() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  const handleComplete = useCallback(() => {
    setSaving(false);
    navigate('/admin/trips');
  }, [navigate]);

  const handleCancel = useCallback(() => {
    navigate('/admin/trips');
  }, [navigate]);

  const handleNavigateToStep = useCallback((stepIndex) => {
    setCurrentStep(stepIndex);
  }, []);

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="trips" onNav={() => {}}>
      <div className="max-w-5xl mx-auto w-full">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-muted mb-6">
          <button
            type="button"
            onClick={() => navigate('/admin/trips')}
            className="hover:text-text transition-colors"
          >
            ← Back to Trips
          </button>
        </nav>

        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-text">Create New Trip</h1>
            <p className="text-muted mt-2 text-base">Create and manage a new transport trip</p>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted">
            <span className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-full font-medium">
              Draft
            </span>
            <span className="font-medium">
              Step {currentStep + 1} of {WIZARD_STEPS.length}
            </span>
          </div>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-between mb-10">
          {WIZARD_STEPS.map((step, index) => {
            const isCompleted = index < currentStep;
            const isCurrent = index === currentStep;

            return (
              <div key={step.key} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                      isCompleted
                        ? 'bg-green-500 text-white'
                        : isCurrent
                        ? 'bg-amber-500 text-white'
                        : 'bg-gray-200 text-gray-500'
                    }`}
                  >
                    {isCompleted ? '✓' : index + 1}
                  </div>
                  <div className="mt-2 text-center">
                    <div
                      className={`text-sm font-semibold ${
                        isCurrent ? 'text-text' : isCompleted ? 'text-green-600' : 'text-muted'
                      }`}
                    >
                      {step.label}
                    </div>
                    <div className="text-xs text-muted hidden sm:block">{step.description}</div>
                  </div>
                </div>
                {index < WIZARD_STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-1 mx-4 transition-colors ${
                      index < currentStep ? 'bg-green-500' : 'bg-gray-200'
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Main Content */}
        <TripWizard
          onComplete={handleComplete}
          onCancel={handleCancel}
          editingTrip={null}
          onNavigateToStep={handleNavigateToStep}
          currentStep={currentStep}
          onStepChange={setCurrentStep}
        />
      </div>
    </AdminShell>
  );
}

export default AdminCreateTrip;
