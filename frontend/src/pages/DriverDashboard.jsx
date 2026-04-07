import { useState, useEffect, useContext } from 'react';
import { Link } from 'react-router-dom';
import { AuthContext } from '../App';
import { driverAPI } from '../services/api';

function DriverDashboard() {
  const { user } = useContext(AuthContext);
  const [activeTab, setActiveTab] = useState('jobs');
  const [jobs, setJobs] = useState([]);
  const [myJobs, setMyJobs] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedVehicle, setSelectedVehicle] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [jobsRes, myJobsRes, vehiclesRes, statsRes] = await Promise.all([
        driverAPI.getAvailableJobs(),
        driverAPI.getMyJobs(),
        driverAPI.getMyVehicles(),
        driverAPI.getStats()
      ]);

      if (jobsRes.data.success) setJobs(jobsRes.data.data);
      if (myJobsRes.data.success) setMyJobs(myJobsRes.data.data);
      if (vehiclesRes.data.success) setVehicles(vehiclesRes.data.data);
      if (statsRes.data.success) setStats(statsRes.data.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptJob = async (bookingId) => {
    if (!selectedVehicle) {
      alert('Please select a vehicle first');
      return;
    }

    try {
      const response = await driverAPI.acceptJob(bookingId, selectedVehicle);
      if (response.data.success) {
        fetchData();
        setSelectedJob(null);
        setSelectedVehicle('');
        alert('Job accepted successfully!');
      }
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to accept job');
    }
  };

  const handleUpdateStatus = async (bookingId, status) => {
    try {
      const response = await driverAPI.updateJobStatus(bookingId, status, '');
      if (response.data.success) {
        fetchData();
        alert('Status updated successfully!');
      }
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to update status');
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      pending: { class: 'badge-pending', label: 'Pending' },
      confirmed: { class: 'badge-confirmed', label: 'Confirmed' },
      pickup_completed: { class: 'badge-in-transit', label: 'Pickup Done' },
      in_transit: { class: 'badge-in-transit', label: 'In Transit' },
      delivered: { class: 'badge-delivered', label: 'Delivered' }
    };
    const badge = badges[status] || badges.pending;
    return <span className={`badge ${badge.class}`}>{badge.label}</span>;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Driver Dashboard</h1>
          <p className="text-gray-600">Welcome, {user?.first_name}!</p>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="card">
              <div className="text-2xl font-bold text-amber-500">{stats.total_deliveries}</div>
              <div className="text-gray-600">Total Deliveries</div>
            </div>
            <div className="card">
              <div className="text-2xl font-bold text-green-600">{stats.rating}</div>
              <div className="text-gray-600">Rating</div>
            </div>
            <div className="card">
              <div className="text-2xl font-bold text-purple-600">{stats.active_jobs}</div>
              <div className="text-gray-600">Active Jobs</div>
            </div>
            <div className="card">
              <div className="text-2xl font-bold text-sky-500">{stats.is_available ? 'Available' : 'Busy'}</div>
              <div className="text-gray-600">Current Status</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex space-x-4 mb-6">
          <button
            onClick={() => setActiveTab('jobs')}
            className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'jobs' ? 'bg-amber-500 text-white' : 'bg-white text-gray-700'}`}
          >
            Available Jobs ({jobs.length})
          </button>
          <button
            onClick={() => setActiveTab('myjobs')}
            className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'myjobs' ? 'bg-amber-500 text-white' : 'bg-white text-gray-700'}`}
          >
            My Jobs ({myJobs.length})
          </button>
        </div>

        {/* Available Jobs Tab */}
        {activeTab === 'jobs' && (
          <div className="card">
            <h2 className="text-xl font-semibold mb-4">Available Transport Jobs</h2>
            {jobs.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No available jobs at the moment</p>
            ) : (
              <div className="space-y-4">
                {jobs.map((job) => (
                  <div key={job.booking_id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between">
                      <div className="flex-1">
                        <div className="flex items-center mb-2">
                          <span className="font-semibold text-amber-500 mr-3">{job.booking_reference}</span>
                          <span className="badge bg-gray-100 text-gray-700">{job.vehicle_type_required}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-gray-500">From:</span> {job.pickup_city}
                          </div>
                          <div>
                            <span className="text-gray-500">To:</span> {job.drop_city}
                          </div>
                          <div>
                            <span className="text-gray-500">Goods:</span> {job.goods_description?.substring(0, 50)}...
                          </div>
                          <div>
                            <span className="text-gray-500">Est. Price:</span> ₹{job.estimated_price}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 md:mt-0 md:ml-4">
                        {selectedJob === job.booking_id ? (
                          <div className="space-y-2">
                            <select
                              value={selectedVehicle}
                              onChange={(e) => setSelectedVehicle(e.target.value)}
                              className="input-field"
                            >
                              <option value="">Select Vehicle</option>
                              {vehicles.map((v) => (
                                <option key={v.vehicle_id} value={v.vehicle_id}>
                                  {v.vehicle_number} - {v.vehicle_name}
                                </option>
                              ))}
                            </select>
                            <div className="flex space-x-2">
                              <button
                                onClick={() => handleAcceptJob(job.booking_id)}
                                className="btn-primary text-sm"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setSelectedJob(null)}
                                className="px-4 py-2 border border-gray-300 rounded-lg text-sm"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setSelectedJob(job.booking_id)}
                            className="btn-primary text-sm"
                          >
                            Accept Job
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* My Jobs Tab */}
        {activeTab === 'myjobs' && (
          <div className="card">
            <h2 className="text-xl font-semibold mb-4">My Active Jobs</h2>
            {myJobs.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No active jobs</p>
            ) : (
              <div className="space-y-4">
                {myJobs.map((job) => (
                  <div key={job.booking_id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between">
                      <div className="flex-1">
                        <div className="flex items-center mb-2">
                          <span className="font-semibold text-amber-500 mr-3">{job.booking_reference}</span>
                          {getStatusBadge(job.status)}
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                          <div>
                            <span className="text-gray-500">Route:</span> {job.pickup_city} → {job.drop_city}
                          </div>
                          <div>
                            <span className="text-gray-500">Customer:</span> {job.customer_first_name} {job.customer_last_name}
                          </div>
                          <div>
                            <span className="text-gray-500">Goods:</span> {job.goods_description?.substring(0, 40)}...
                          </div>
                          <div>
                            <span className="text-gray-500">Vehicle:</span> {job.vehicle_number}
                          </div>
                        </div>
                        {job.status_description && (
                          <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded">
                            {job.status_description}
                          </div>
                        )}
                      </div>
                      <div className="mt-4 md:mt-0 md:ml-4 flex flex-col gap-2">
                        {job.status === 'confirmed' && (
                          <button
                            onClick={() => handleUpdateStatus(job.booking_id, 'pickup_completed')}
                            className="btn-secondary text-sm"
                          >
                            Mark Pickup Complete
                          </button>
                        )}
                        {job.status === 'pickup_completed' && (
                          <button
                            onClick={() => handleUpdateStatus(job.booking_id, 'in_transit')}
                            className="btn-secondary text-sm"
                          >
                            Start Transit
                          </button>
                        )}
                        {job.status === 'in_transit' && (
                          <button
                            onClick={() => handleUpdateStatus(job.booking_id, 'delivered')}
                            className="btn-primary text-sm"
                          >
                            Mark Delivered
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default DriverDashboard;

