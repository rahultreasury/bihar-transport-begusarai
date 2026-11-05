const express = require('express');
const router = express.Router();

// Get available time slots
router.get('/slots', (req, res) => {
  const { date, rto_office } = req.query;
  
  // Generate time slots
  const slots = [
    { time: '09:00 AM', available: true },
    { time: '09:30 AM', available: true },
    { time: '10:00 AM', available: false },
    { time: '10:30 AM', available: true },
    { time: '11:00 AM', available: true },
    { time: '11:30 AM', available: true },
    { time: '12:00 PM', available: false },
    { time: '12:30 PM', available: true },
    { time: '01:00 PM', available: true },
    { time: '01:30 PM', available: true },
    { time: '02:00 PM', available: false },
    { time: '02:30 PM', available: true },
    { time: '03:00 PM', available: true },
    { time: '03:30 PM', available: true },
    { time: '04:00 PM', available: false },
    { time: '04:30 PM', available: true }
  ];
  
  // Randomly mark some slots as unavailable for demo
  const randomSlots = slots.map(slot => ({
    ...slot,
    available: slot.available && Math.random() > 0.3
  }));
  
  res.json({
    success: true,
    data: randomSlots
  });
});

// Create appointment
router.post('/create', (req, res) => {
  const { 
    appointment_type, 
    appointment_date, 
    appointment_time, 
    rto_office, 
    remarks,
    user_id 
  } = req.body;
  
  // Generate appointment ID
  const appointmentId = Date.now();
  const slotNumber = Math.floor(Math.random() * 100) + 1;
  
  // In a real app, save to database
  // For demo, return success
  
  res.json({
    success: true,
    message: 'Appointment booked successfully',
    data: {
      appointment_id: appointmentId,
      appointment_type,
      appointment_date,
      appointment_time,
      rto_office,
      remarks,
      slot_number: `SLOT-${slotNumber}`,
      status: 'booked'
    }
  });
});

// Get all appointments (user or admin)
router.get('/', (req, res) => {
  const { user_id, status } = req.query;
  
  // Mock appointments data
  const appointments = [
    {
      appointment_id: 1,
      appointment_type: 'license_renewal',
      appointment_date: '2024-03-15',
      appointment_time: '10:00 AM',
      rto_office: 'Patna RTO',
      remarks: 'Renewal of driving license',
      slot_number: 'SLOT-15',
      status: 'booked',
      created_at: '2024-03-01 10:00:00'
    },
    {
      appointment_id: 2,
      appointment_type: 'vehicle_registration',
      appointment_date: '2024-02-20',
      appointment_time: '02:00 PM',
      rto_office: 'Begusarai RTO',
      remarks: 'New vehicle registration - Honda City',
      slot_number: 'SLOT-22',
      status: 'completed',
      created_at: '2024-02-10 14:30:00'
    }
  ];
  
  // Filter by user_id if provided
  let filteredAppointments = appointments;
  if (user_id) {
    filteredAppointments = appointments.filter(apt => apt.user_id === parseInt(user_id));
  }
  
  // Filter by status if provided
  if (status) {
    filteredAppointments = filteredAppointments.filter(apt => apt.status === status);
  }
  
  res.json({
    success: true,
    data: filteredAppointments
  });
});

// Cancel appointment
router.put('/:id/cancel', (req, res) => {
  const { id } = req.params;
  
  // In a real app, update the database
  res.json({
    success: true,
    message: 'Appointment cancelled successfully'
  });
});

module.exports = router;

