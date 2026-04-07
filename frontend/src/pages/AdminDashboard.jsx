import { useState, useEffect, useContext } from 'react';
import { Link } from 'react-router-dom';
import { AuthContext } from '../App';
import { adminAPI } from '../services/api';

function AdminDashboard() {
  const { user } = useContext(AuthContext);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashboard, setDashboard] = useState(null);
  const [users, setUsers] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const response = await adminAPI.getDashboard();
      if (response.data.success) {
        setDashboard(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await adminAPI.getUsers({ limit: 50 });
      if (response.data.success) setUsers(response.data.data);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const fetchDrivers = async () => {
    try {
      const response = await adminAPI.getDrivers({ limit: 50 });
      if (response.data.success) setDrivers(response.data.data);
    } catch (error) {
      console.error('Error fetching drivers:', error);
    }
  };

  const fetchBookings = async () => {
    try {
      const response = await adminAPI.getBookings({ limit: 50 });
      if (response.data.success) setBookings(response.data.data);
    } catch (error) {
      console.error('Error fetching bookings:', error);
    }
  };

  useEffect(() => {
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'drivers') fetchDrivers();
    if (activeTab === 'bookings') fetchBookings();
  }, [activeTab]);

  const getStatusBadge = (status) => {
    const badges = {
      pending: { class: 'badge-pending', label: 'Pending' },
      confirmed: { class: 'badge-confirmed', label: 'Confirmed' },
      in_transit: { class: 'badge-in-transit', label: 'In Transit' },
      delivered: { class: 'badge-delivered', label: 'Delivered' },
      cancelled: { class: 'badge-cancelled', label: 'Cancelled' }
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
          <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-gray-600">Welcome, {user?.full_name || user?.first_name}!</p>
        </div>

        {/* Stats */}
        {dashboard && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="card">
              <div className="text-2xl font-bold text-amber-500">{dashboard.stats.totalUsers}</div>
              <div className="text-gray-600">Total Customers</div>
            </div>
            <div className="card">
              <div className="text-2xl font-bold text-green-600">{dashboard.stats.totalDrivers}</div>
              <div className="text-gray-600">Total Drivers</div>
            </div>
            <div className="card">
              <div className="text-2xl font-bold text-purple-600">{dashboard.stats.activeDeliveries}</div>
              <div className="text-gray-600">Active Deliveries</div>
            </div>
            <div className="card">
              <div className="text-2xl font-bold text-sky-500">₹{dashboard.stats.totalRevenue?.toLocaleString()}</div>
              <div className="text-gray-600">Total Revenue</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'dashboard' ? 'bg-amber-500 text-white' : 'bg-white text-gray-700'}`}
          >
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab('bookings')}
            className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'bookings' ? 'bg-amber-500 text-white' : 'bg-white text-gray-700'}`}
          >
            Bookings
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'users' ? 'bg-amber-500 text-white' : 'bg-white text-gray-700'}`}
          >
            Customers
          </button>
          <button
            onClick={() => setActiveTab('drivers')}
            className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'drivers' ? 'bg-amber-500 text-white' : 'bg-white text-gray-700'}`}
          >
            Drivers
          </button>
        </div>

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && dashboard && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Recent Bookings */}
            <div className="card">
              <h3 className="text-lg font-semibold mb-4">Recent Bookings</h3>
              <div className="space-y-3">
                {dashboard.recentBookings.map((booking) => (
                  <div key={booking.booking_id} className="flex items-center justify-between border-b pb-2">
                    <div>
                      <p className="font-medium text-amber-500">{booking.booking_reference}</p>
                      <p className="text-sm text-gray-500">{booking.pickup_city} → {booking.drop_city}</p>
                    </div>
                    <div className="text-right">
                      {getStatusBadge(booking.status)}
                      <p className="text-sm font-medium">₹{booking.final_price}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Available Drivers */}
            <div className="card">
              <h3 className="text-lg font-semibold mb-4">Available Drivers</h3>
              <div className="space-y-3">
                {dashboard.availableDrivers.map((driver) => (
                  <div key={driver.driver_id} className="flex items-center justify-between border-b pb-2">
                    <div className="flex items-center">
                      <div className="w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center text-white font-bold mr-3">
                        {driver.first_name?.[0]}
                      </div>
                      <div>
                        <p className="font-medium">{driver.first_name} {driver.last_name}</p>
                        <p className="text-sm text-gray-500">⭐ {driver.rating}</p>
                      </div>
                    </div>
                    <span className="text-green-600 text-sm">Available</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Bookings Tab */}
        {activeTab === 'bookings' && (
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">All Bookings</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2">Ref</th>
                    <th className="text-left py-3 px-2">Route</th>
                    <th className="text-left py-3 px-2">Customer</th>
                    <th className="text-left py-3 px-2">Status</th>
                    <th className="text-left py-3 px-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((booking) => (
                    <tr key={booking.booking_id} className="border-b">
                      <td className="py-3 px-2 font-medium text-amber-500">{booking.booking_reference}</td>
                      <td className="py-3 px-2">{booking.pickup_city} → {booking.drop_city}</td>
                      <td className="py-3 px-2">{booking.customer_first_name} {booking.customer_last_name}</td>
                      <td className="py-3 px-2">{getStatusBadge(booking.status)}</td>
                      <td className="py-3 px-2 font-medium">₹{booking.final_price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">All Customers</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2">Name</th>
                    <th className="text-left py-3 px-2">Email</th>
                    <th className="text-left py-3 px-2">Phone</th>
                    <th className="text-left py-3 px-2">City</th>
                    <th className="text-left py-3 px-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.user_id} className="border-b">
                      <td className="py-3 px-2">{u.first_name} {u.last_name}</td>
                      <td className="py-3 px-2">{u.email}</td>
                      <td className="py-3 px-2">{u.phone}</td>
                      <td className="py-3 px-2">{u.city}</td>
                      <td className="py-3 px-2">
                        <span className={`badge ${u.is_active ? 'badge-delivered' : 'badge-cancelled'}`}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Drivers Tab */}
        {activeTab === 'drivers' && (
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">All Drivers</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2">Name</th>
                    <th className="text-left py-3 px-2">Phone</th>
                    <th className="text-left py-3 px-2">License</th>
                    <th className="text-left py-3 px-2">Rating</th>
                    <th className="text-left py-3 px-2">Deliveries</th>
                    <th className="text-left py-3 px-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((driver) => (
                    <tr key={driver.driver_id} className="border-b">
                      <td className="py-3 px-2">{driver.first_name} {driver.last_name}</td>
                      <td className="py-3 px-2">{driver.phone}</td>
                      <td className="py-3 px-2 text-sm">{driver.license_number}</td>
                      <td className="py-3 px-2">⭐ {driver.rating}</td>
                      <td className="py-3 px-2">{driver.total_deliveries}</td>
                      <td className="py-3 px-2">
                        <span className={`badge ${driver.is_available ? 'badge-delivered' : 'badge-pending'}`}>
                          {driver.is_available ? 'Available' : 'Busy'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminDashboard;

