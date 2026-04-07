import { useState } from 'react';
import { licenseAPI } from '../services/api';

function LicenseSearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const [license, setLicense] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setLoading(true);
    setError('');
    setLicense(null);

    try {
      const response = await licenseAPI.search(searchQuery);
      if (response.data.success) {
        setLicense(response.data.data);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'License not found');
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

  const getExpiryBadge = (status) => {
    const styles = {
      valid: 'badge-success',
      expiring_soon: 'badge-warning',
      expired: 'badge-danger'
    };
    return styles[status] || 'badge-info';
  };

  const getLicenseTypeLabel = (type) => {
    const labels = {
      learner: 'Learner License',
      permanent: 'Permanent License',
      commercial: 'Commercial License'
    };
    return labels[type] || type;
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Driving License Information</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Search and verify driving license status, holder information, and validity
          </p>
        </div>

        {/* Search Form */}
        <div className="gov-card p-8 mb-8">
          <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Enter License Number (e.g., DL/BR/012345/2020)"
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
                <h3 className="text-xl font-semibold text-red-800">License Not Found</h3>
                <p className="text-red-600">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-primary-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Searching license details...</p>
          </div>
        )}

        {/* License Details */}
        {license && !loading && (
          <div className="animate-fadeIn">
            {/* Status Banner */}
            <div className={`gov-card p-4 mb-6 flex items-center justify-between flex-wrap gap-4 ${
              license.status === 'active' ? 'bg-green-50 border-green-200' : 
              license.status === 'expired' ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'
            }`}>
              <div className="flex items-center gap-3">
                <span className={`text-2xl ${license.status === 'active' ? 'text-green-600' : 'text-red-600'}`}>
                  {license.status === 'active' ? '✓' : '✗'}
                </span>
                <div>
                  <span className={`font-semibold ${license.status === 'active' ? 'text-green-800' : 'text-red-800'}`}>
                    {license.status === 'active' ? 'Valid License' : 'License Status: ' + license.status.toUpperCase()}
                  </span>
                  {license.expiry_status && (
                    <p className={`text-sm ${license.expiry_status === 'expired' ? 'text-red-600' : license.expiry_status === 'expiring_soon' ? 'text-yellow-600' : 'text-green-600'}`}>
                      ({license.expiry_status === 'expired' ? 'Expired' : license.expiry_status === 'expiring_soon' ? 'Expiring Soon' : 'Valid'})
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <span className={`badge ${getStatusBadge(license.status)}`}>
                  {license.status}
                </span>
                {license.expiry_status && (
                  <span className={`badge ${getExpiryBadge(license.expiry_status)}`}>
                    {license.expiry_status === 'expiring_soon' ? 'Expiring Soon' : license.expiry_status}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Basic Info */}
              <div className="gov-card p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  License Details
                </h3>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-500">License Number</p>
                    <p className="text-xl font-bold text-primary-600">{license.license_number}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">License Type</p>
                    <p className="font-semibold">{getLicenseTypeLabel(license.license_type)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">State</p>
                    <p className="font-semibold">{license.state}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Issuing Authority</p>
                    <p className="font-semibold">{license.issuing_authority}</p>
                  </div>
                </div>
              </div>

              {/* Holder Info */}
              <div className="gov-card p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Holder Details
                </h3>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-500">Name</p>
                    <p className="font-semibold">{license.holder_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Date of Birth</p>
                    <p className="font-semibold">{new Date(license.date_of_birth).toLocaleDateString('en-IN')}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Gender</p>
                    <p className="font-semibold capitalize">{license.gender}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Blood Group</p>
                    <p className="font-semibold">{license.blood_group || 'N/A'}</p>
                  </div>
                  {license.contact && (
                    <>
                      <div>
                        <p className="text-sm text-gray-500">Email</p>
                        <p className="font-semibold">{license.contact.email || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Phone</p>
                        <p className="font-semibold">{license.contact.phone || 'N/A'}</p>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Validity Info */}
              <div className="gov-card p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Validity Information
                </h3>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-500">Issue Date</p>
                    <p className="font-semibold">{new Date(license.issue_date).toLocaleDateString('en-IN')}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Expiry Date</p>
                    <p className={`font-semibold text-lg ${
                      new Date(license.expiry_date) < new Date() ? 'text-red-600' : 
                      new Date(license.expiry_date) < new Date(Date.now() + 30*24*60*60*1000) ? 'text-yellow-600' : 'text-green-600'
                    }`}>
                      {new Date(license.expiry_date).toLocaleDateString('en-IN')}
                    </p>
                  </div>
                  <div className="pt-4 border-t">
                    <p className="text-sm text-gray-500 mb-2">Time Remaining</p>
                    {(() => {
                      const today = new Date();
                      const expiry = new Date(license.expiry_date);
                      const diffTime = expiry - today;
                      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                      
                      if (diffDays < 0) {
                        return <p className="text-red-600 font-bold">Expired {Math.abs(diffDays)} days ago</p>;
                      } else if (diffDays <= 30) {
                        return <p className="text-yellow-600 font-bold">{diffDays} days remaining</p>;
                      } else {
                        const years = Math.floor(diffDays / 365);
                        const months = Math.floor((diffDays % 365) / 30);
                        return <p className="text-green-600 font-bold">{years > 0 ? `${years} year, ` : ''}{months} months remaining</p>;
                      }
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sample Numbers */}
        <div className="mt-12 gov-card p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Sample License Numbers for Testing</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {['DL/BR/012345/2020', 'DL/BR/067890/2021', 'DL/BR/023456/2019'].map((num) => (
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

export default LicenseSearch;

