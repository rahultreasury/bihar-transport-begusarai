import { useState, useEffect, useContext } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AuthContext } from '../App';
import { bookingAPI } from '../services/api';

function Dashboard() {
  const { user } = useContext(AuthContext);
  const location = useLocation();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(location.state?.message || '');

  useEffect(() => {
    fetchBookings();
    // Clear message after 5 seconds
    if (message) {
      const timer = setTimeout(() => setMessage(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const fetchBookings = async () => {
    try {
      const response = await bookingAPI.getMyBookings();
      if (response.data.success) {
        setBookings(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching bookings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (bookingId) => {
    if (!confirm('Are you sure you want to cancel this booking?')) return;
    
    try {
      const response = await bookingAPI.cancelBooking(bookingId);
      if (response.data.success) {
        fetchBookings();
        setMessage('Booking cancelled successfully');
      }
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to cancel booking');
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      pending: { class: 'badge-pending', label: 'Pending' },
      confirmed: { class: 'badge-confirmed', label: 'Confirmed' },
      driver_assigned: { class: 'badge-confirmed', label: 'Driver Assigned' },
      pickup_completed: { class: 'badge-in-transit', label: 'Pickup Completed' },
      in_transit: { class: 'badge-in-transit', label: 'In Transit' },
      delivered: { class: 'badge-delivered', label: 'Delivered' },
      completed: { class: 'badge-delivered', label: 'Completed' },
      cancelled: { class: 'badge-cancelled', label: 'Cancelled' }
    };
    const badge = badges[status] || badges.pending;
    return <span className={`badge ${badge.class}`}>{badge.label}</span>;
  };

  const stats = [
    { label: 'Total Bookings', value: bookings.length, color: 'bg-blue-500' },
    { label: 'Pending', value: bookings.filter(b => b.status === 'pending').length, color: 'bg-yellow-500' },
    { label: 'In Transit', value: bookings.filter(b => ['confirmed', 'driver_assigned', 'pickup_completed', 'in_transit'].includes(b.status)).length, color: 'bg-purple-500' },
    { label: 'Completed', value: bookings.filter(b => ['delivered', 'completed'].includes(b.status)).length, color: 'bg-green-500' }
  ];

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
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">My Dashboard</h1>
            <p className="text-gray-600">Welcome back, {user?.first_name}!</p>
          </div>
          <Link to="/book-transport" className="btn-primary mt-4 md:mt-0 inline-block text-center">
            + New Booking
          </Link>
        </div>

        {message && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg mb-6">
            {message}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {stats.map((stat, index) => (
            <div key={index} className="card">
              <div className="flex items-center">
                <div className={`w-12 h-12 ${stat.color} rounded-lg flex items-center justify-center text-white`}>
                  <span className="text-xl font-bold">{stat.value}</span>
                </div>
                <span className="ml-3 text-gray-600">{stat.label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Bookings Table */}
        <div className="card">
          <h2 className="text-xl font-semibold mb-4">My Bookings</h2>
          
          {bookings.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 mb-4">No bookings yet</p>
              <Link to="/book-transport" className="btn-primary">
                Book Your First Transport
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-semibold text-gray-600">Booking Ref</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600">Route</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600">Goods</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600">Date</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600">Amount</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600">Status</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((booking) => (
                    <tr key={booking.booking_id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <span className="font-medium text-amber-500">{booking.booking_reference}</span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-sm">
                          <div>{booking.pickup_city}</div>
                          <div className="text-gray-400">to {booking.drop_city}</div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-sm max-w-[150px] truncate" title={booking.goods_description}>
                          {booking.goods_description}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-sm">
                        {new Date(booking.pickup_date).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 font-semibold">
                        ₹{booking.final_price || booking.estimated_price}
                      </td>
                      <td className="py-3 px-4">
                        {getStatusBadge(booking.status)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex space-x-2">
                          <Link 
                            to={`/track?ref=${booking.booking_reference}`}
                            className="text-blue-600 hover:text-blue-800 text-sm"
                          >
                            Track
                          </Link>
                          {booking.status === 'pending' && (
                            <button
                              onClick={() => handleCancel(booking.booking_id)}
                              className="text-red-600 hover:text-red-800 text-sm"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;

