import { useState, useEffect, useContext } from 'react';
import { appointmentAPI } from '../services/api';
import { AuthContext } from '../App';

function Appointment() {
  const { user } = useContext(AuthContext);
  const [activeTab, setActiveTab] = useState('book');
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState([]);
  
  const [formData, setFormData] = useState({
    appointment_type: 'license_issue',
    appointment_date: '',
    appointment_time: '',
    rto_office: 'Patna RTO',
    remarks: ''
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const appointmentTypes = [
    { value: 'license_issue', label: 'New License Issue' },
    { value: 'license_renewal', label: 'License Renewal' },
    { value: 'vehicle_registration', label: 'New Vehicle Registration' },
    { value: 'vehicle_renewal', label: 'Vehicle Renewal' },
    { value: 'duplicate_rc', label: 'Duplicate RC' },
    { value: 'transfer_ownership', label: 'Transfer of Ownership' },
    { value: 'Driving Test', label: 'Driving Test' },
    { value: 'Document Verification', label: 'Document Verification' }
  ];

  const rtoOffices = [
    'Patna RTO',
    'Gaya RTO',
    'Muzaffarpur RTO',
    'Bhagalpur RTO',
    'Darbhanga RTO',
    'Purnia RTO',
    'Bihar Sharif RTO',
    'Arrah RTO'
  ];

  useEffect(() => {
    if (user && activeTab === 'my') {
      fetchAppointments();
    }
  }, [user, activeTab]);

  useEffect(() => {
    if (formData.appointment_date && formData.rto_office) {
      fetchSlots();
    }
  }, [formData.appointment_date, formData.rto_office]);

  const fetchAppointments = async () => {
    setLoading(true);
    try {
      const response = await appointmentAPI.getAll({});
      if (response.data.success) {
        setAppointments(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching appointments:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSlots = async () => {
    try {
      const response = await appointmentAPI.getSlots({
        date: formData.appointment_date,
        rto_office: formData.rto_office
      });
      if (response.data.success) {
        setSlots(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching slots:', err);
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError('');
    setSuccess('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!user) {
      setError('Please login to book an appointment');
      return;
    }

    if (!formData.appointment_date || !formData.appointment_time) {
      setError('Please select date and time');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await appointmentAPI.create(formData);
      if (response.data.success) {
        setSuccess('Appointment booked successfully!');
        setFormData({
          appointment_type: 'license_issue',
          appointment_date: '',
          appointment_time: '',
          rto_office: 'Patna RTO',
          remarks: ''
        });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Error booking appointment');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (appointmentId) => {
    if (!confirm('Are you sure you want to cancel this appointment?')) return;

    try {
      await appointmentAPI.cancel(appointmentId);
      fetchAppointments();
      alert('Appointment cancelled successfully');
    } catch (err) {
      alert('Error cancelling appointment');
    }
  };

  const getStatusBadge = (status) => {
    const styles = {
      booked: 'badge-info',
      completed: 'badge-success',
      cancelled: 'badge-danger',
      no_show: 'badge-warning'
    };
    return styles[status] || 'badge-info';
  };

  // Get minimum date (tomorrow)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split('T')[0];

  // Get maximum date (3 months from now)
  const maxDate = new Date();
  maxDate.setMonth(maxDate.getMonth() + 3);
  const maxDateStr = maxDate.toISOString().split('T')[0];

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Book RTO Appointment</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Schedule your visit to the RTO for various transport services
          </p>
        </div>

        {/* Tabs */}
        <div className="flex justify-center mb-8">
          <div className="bg-white rounded-lg p-1 shadow-md inline-flex">
            <button
              onClick={() => setActiveTab('book')}
              className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                activeTab === 'book'
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Book Appointment
            </button>
            <button
              onClick={() => setActiveTab('my')}
              className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                activeTab === 'my'
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              My Appointments
            </button>
          </div>
        </div>

        {/* Book Appointment Tab */}
        {activeTab === 'book' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Booking Form */}
            <div className="gov-card p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Book New Appointment</h2>
              
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
                  {error}
                </div>
              )}

              {success && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6">
                  {success}
                </div>
              )}

              {!user && (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-lg mb-6">
                  Please login to book an appointment
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Appointment Type
                  </label>
                  <select
                    name="appointment_type"
                    value={formData.appointment_type}
                    onChange={handleChange}
                    className="gov-input"
                    required
                  >
                    {appointmentTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    RTO Office
                  </label>
                  <select
                    name="rto_office"
                    value={formData.rto_office}
                    onChange={handleChange}
                    className="gov-input"
                    required
                  >
                    {rtoOffices.map((office) => (
                      <option key={office} value={office}>
                        {office}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Date
                  </label>
                  <input
                    type="date"
                    name="appointment_date"
                    value={formData.appointment_date}
                    onChange={handleChange}
                    min={minDate}
                    max={maxDateStr}
                    className="gov-input"
                    required
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    Select a date within the next 3 months
                  </p>
                </div>

                {formData.appointment_date && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Time Slot
                    </label>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                      {slots.map((slot) => (
                        <button
                          key={slot.time}
                          type="button"
                          disabled={!slot.available}
                          onClick={() => setFormData({ ...formData, appointment_time: slot.time })}
                          className={`py-2 px-3 rounded-lg text-sm font-semibold transition-all ${
                            formData.appointment_time === slot.time
                              ? 'bg-primary-600 text-white'
                              : slot.available
                              ? 'bg-gray-100 hover:bg-gray-200 text-gray-800'
                              : 'bg-gray-50 text-gray-400 cursor-not-allowed'
                          }`}
                        >
                          {slot.time}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Remarks (Optional)
                  </label>
                  <textarea
                    name="remarks"
                    value={formData.remarks}
                    onChange={handleChange}
                    rows={3}
                    className="gov-input"
                    placeholder="Any additional information..."
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !user || !formData.appointment_time}
                  className="w-full gov-btn gov-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Booking...' : 'Book Appointment'}
                </button>
              </form>
            </div>

            {/* Info Sidebar */}
            <div className="space-y-6">
              <div className="gov-card p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Appointment Guidelines</h3>
                <ul className="space-y-3 text-gray-600">
                  <li className="flex items-start gap-2">
                    <span className="text-primary-600">✓</span>
                    Please arrive at the RTO office 15 minutes before your scheduled time
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary-600">✓</span>
                    Bring all required documents in original and photocopy
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary-600">✓</span>
                    Carry a printout of your appointment confirmation
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary-600">✓</span>
                    Cancellations should be done at least 24 hours before the appointment
                  </li>
                </ul>
              </div>

              <div className="gov-card p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Documents Required</h3>
                <ul className="space-y-2 text-gray-600">
                  <li>• Application Form</li>
                  <li>• Address Proof</li>
                  <li>• Age Proof</li>
                  <li>• Passport Size Photos</li>
                  <li>• Previous License (if renewal)</li>
                  <li>• Vehicle Documents (if applicable)</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* My Appointments Tab */}
        {activeTab === 'my' && (
          <div>
            {loading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-primary-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">Loading appointments...</p>
              </div>
            ) : appointments.length === 0 ? (
              <div className="gov-card p-12 text-center">
                <div className="bg-gray-100 p-4 rounded-full inline-flex mb-4">
                  <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">No Appointments</h3>
                <p className="text-gray-600">You haven't booked any appointments yet.</p>
                <button
                  onClick={() => setActiveTab('book')}
                  className="mt-4 px-6 py-3 bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-700 transition-all"
                >
                  Book Now
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {appointments.map((apt) => (
                  <div key={apt.appointment_id} className="gov-card p-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className={`badge ${getStatusBadge(apt.status)}`}>
                            {apt.status.toUpperCase()}
                          </span>
                          <span className="font-mono text-sm text-gray-500">
                            Slot: {apt.slot_number}
                          </span>
                        </div>
                        <h3 className="text-xl font-semibold text-gray-900 mb-2">
                          {appointmentTypes.find(t => t.value === apt.appointment_type)?.label || apt.appointment_type}
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-gray-600">
                          <div>
                            <p className="text-sm text-gray-500">Date</p>
                            <p className="font-semibold">{new Date(apt.appointment_date).toLocaleDateString('en-IN')}</p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-500">Time</p>
                            <p className="font-semibold">{apt.appointment_time}</p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-500">RTO Office</p>
                            <p className="font-semibold">{apt.rto_office}</p>
                          </div>
                        </div>
                        {apt.remarks && (
                          <p className="mt-2 text-gray-600 text-sm">
                            <span className="font-semibold">Remarks:</span> {apt.remarks}
                          </p>
                        )}
                      </div>
                      {apt.status === 'booked' && (
                        <button
                          onClick={() => handleCancel(apt.appointment_id)}
                          className="px-6 py-2 border border-red-300 text-red-600 rounded-lg font-semibold hover:bg-red-50 transition-all"
                        >
                          Cancel
                        </button>
                      )}
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

export default Appointment;

