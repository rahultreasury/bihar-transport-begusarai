import { useState } from 'react';
import { challanAPI } from '../services/api';

function ChallanSearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const [challans, setChallans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedChallan, setSelectedChallan] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setLoading(true);
    setError('');
    setChallans([]);
    setSelectedChallan(null);

    try {
      const response = await challanAPI.search(searchQuery);
      if (response.data.success) {
        setChallans(response.data.data);
        if (response.data.data.length === 0) {
          setError('No challans found for this vehicle');
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Error searching challans');
    } finally {
      setLoading(false);
    }
  };

  const handlePayChallan = async (challanId) => {
    try {
      await challanAPI.pay(challanId, { payment_mode: 'Online' });
      // Refresh the list
      handleSearch({ preventDefault: () => {} });
      alert('Challan paid successfully!');
    } catch (err) {
      alert('Error paying challan');
    }
  };

  const getStatusBadge = (status) => {
    const styles = {
      pending: 'badge-warning',
      paid: 'badge-success',
      overdue: 'badge-danger'
    };
    return styles[status] || 'badge-info';
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Traffic Challan Status</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Search and view traffic violation challans for your vehicle
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
        {error && !loading && (
          <div className="gov-card p-8 mb-8 border-l-4 border-yellow-500">
            <div className="flex items-center gap-4">
              <div className="bg-yellow-100 p-3 rounded-full">
                <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-xl font-semibold text-yellow-800">No Challans Found</h3>
                <p className="text-yellow-600">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-primary-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Searching challans...</p>
          </div>
        )}

        {/* Challans List */}
        {challans.length > 0 && !loading && (
          <div className="animate-fadeIn">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              <div className="gov-card p-4">
                <p className="text-sm text-gray-500">Total Challans</p>
                <p className="text-2xl font-bold">{challans.length}</p>
              </div>
              <div className="gov-card p-4">
                <p className="text-sm text-gray-500">Pending</p>
                <p className="text-2xl font-bold text-yellow-600">{challans.filter(c => c.status === 'pending').length}</p>
              </div>
              <div className="gov-card p-4">
                <p className="text-sm text-gray-500">Paid</p>
                <p className="text-2xl font-bold text-green-600">{challans.filter(c => c.status === 'paid').length}</p>
              </div>
              <div className="gov-card p-4">
                <p className="text-sm text-gray-500">Total Amount</p>
                <p className="text-2xl font-bold">₹{challans.reduce((sum, c) => sum + parseFloat(c.total_amount), 0).toLocaleString()}</p>
              </div>
            </div>

            {/* Challans Table */}
            <div className="gov-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="gov-table">
                  <thead>
                    <tr>
                      <th>Challan No.</th>
                      <th>Date & Time</th>
                      <th>Violation</th>
                      <th>Location</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {challans.map((challan) => (
                      <tr key={challan.challan_id}>
                        <td className="font-mono font-semibold">{challan.challan_number}</td>
                        <td>{formatDate(challan.violation_date)}</td>
                        <td>{challan.violation_type}</td>
                        <td>{challan.violation_location || 'N/A'}</td>
                        <td className="font-semibold">₹{parseFloat(challan.total_amount).toLocaleString()}</td>
                        <td>
                          <span className={`badge ${getStatusBadge(challan.status)}`}>
                            {challan.status.toUpperCase()}
                          </span>
                        </td>
                        <td>
                          {challan.status === 'pending' || challan.status === 'overdue' ? (
                            <button
                              onClick={() => handlePayChallan(challan.challan_id)}
                              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 transition-colors"
                            >
                              Pay Now
                            </button>
                          ) : (
                            <span className="text-green-600 text-sm font-semibold">✓ Paid</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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

export default ChallanSearch;

