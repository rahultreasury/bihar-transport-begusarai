import { useState } from 'react';
import { vehicleAPI } from '../services/api';

function VehicleSearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const [vehicle, setVehicle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setLoading(true);
    setError('');
    setVehicle(null);

    try {
      const response = await vehicleAPI.search(searchQuery);
      if (response.data.success) {
        setVehicle(response.data.data);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Vehicle not found');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const styles = {
      active: 'badge-success',
      expired: 'badge-danger',
      suspended: 'badge-warning'
    };
    return styles[status] || 'badge-info';
  };

  const getVehicleTypeLabel = (type) => {
    const labels = {
      two_wheeler: 'Two Wheeler',
      four_wheeler: 'Four Wheeler',
      commercial: 'Commercial',
      heavy_vehicle: 'Heavy Vehicle'
    };
    return labels[type] || type;
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Vehicle Information</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Search and verify vehicle registration details, owner information, and validity
          </p>
        </div>

        {/* Search Form */}
        <div className="gov-card p-8 mb-8">
          <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Enter Registration Number (e.g., BR01AB1234)"
                className="gov-input text-lg"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value.toUpperCase())}
              />
            </div>
            <button
              type="submit"
              disabled={loading || !searchQuery.trim()}
              className="px-8 py-3 bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </form>
        </div>

        {/* Error Message */}
        {error && (
          <div className="gov-card p-8 mb-8 border-l-4 border-red-500">
            <div className="flex items-center gap-4">
              <div className="bg-red-100 p-3 rounded-full">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-xl font-semibold text-red-800">Vehicle Not Found</h3>
                <p className="text-red-600">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-primary-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Searching vehicle details...</p>
          </div>
        )}

        {/* Vehicle Details */}
        {vehicle && !loading && (
          <div className="animate-fadeIn">
            {/* Status Banner */}
            <div className={`gov-card p-4 mb-6 flex items-center justify-between ${
              vehicle.status === 'active' ? 'bg-green-50 border-green-200' : 
              vehicle.status === 'expired' ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'
            }`}>
              <div className="flex items-center gap-3">
                <span className={`text-2xl ${vehicle.status === 'active' ? 'text-green-600' : 'text-red-600'}`}>
                  {vehicle.status === 'active' ? '✓' : '✗'}
                </span>
                <span className={`font-semibold ${vehicle.status === 'active' ? 'text-green-800' : 'text-red-800'}`}>
                  {vehicle.status === 'active' ? 'Active Vehicle' : 'Vehicle Status: ' + vehicle.status.toUpperCase()}
                </span>
              </div>
              <span className={`badge ${getStatusBadge(vehicle.status)}`}>
                {vehicle.status}
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Basic Info */}
              <div className="gov-card p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                  </svg>
                  Vehicle Details
                </h3>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-500">Registration Number</p>
                    <p className="text-xl font-bold text-primary-600">{vehicle.registration_number}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Vehicle Type</p>
                    <p className="font-semibold">{getVehicleTypeLabel(vehicle.vehicle_type)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Make & Model</p>
                    <p className="font-semibold">{vehicle.vehicle_make} {vehicle.vehicle_model}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Manufacturing Year</p>
                    <p className="font-semibold">{vehicle.manufacturing_year}</p>
                  </div>
                </div>
              </div>

              {/* Owner Info */}
              <div className="gov-card p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Owner Details
                </h3>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-500">Owner Name</p>
                    <p className="font-semibold">{vehicle.owner_name}</p>
                  </div>
                  {vehicle.owner && (
                    <>
                      <div>
                        <p className="text-sm text-gray-500">Email</p>
                        <p className="font-semibold">{vehicle.owner.email || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Phone</p>
                        <p className="font-semibold">{vehicle.owner.phone || 'N/A'}</p>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Validity Info */}
              <div className="gov-card p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  Validity Information
                </h3>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-500">Registration Date</p>
                    <p className="font-semibold">{new Date(vehicle.registration_date).toLocaleDateString('en-IN')}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Registration Valid Until</p>
                    <p className={`font-semibold ${new Date(vehicle.registration_validity) < new Date() ? 'text-red-600' : 'text-green-600'}`}>
                      {new Date(vehicle.registration_validity).toLocaleDateString('en-IN')}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Insurance Valid Until</p>
                    <p className={`font-semibold ${new Date(vehicle.insurance_validity) < new Date() ? 'text-red-600' : ''}`}>
                      {vehicle.insurance_validity ? new Date(vehicle.insurance_validity).toLocaleDateString('en-IN') : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">PUC Valid Until</p>
                    <p className={`font-semibold ${new Date(vehicle.pollution_validity) < new Date() ? 'text-red-600' : ''}`}>
                      {vehicle.pollution_validity ? new Date(vehicle.pollution_validity).toLocaleDateString('en-IN') : 'N/A'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sample Numbers */}
        <div className="mt-12 gov-card p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Sample Registration Numbers for Testing</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {['BR01AB1234', 'BR01CD5678', 'BR01EF9012', 'BR01GH3456'].map((num) => (
              <button
                key={num}
                onClick={() => setSearchQuery(num)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg font-mono text-sm transition-colors"
              >
                {num}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default VehicleSearch;

