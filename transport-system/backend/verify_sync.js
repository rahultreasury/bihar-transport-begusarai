const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const activeStatuses = ['PENDING', 'ASSIGNED', 'TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED'];
  
  const drivers = await prisma.driver.findMany({
    select: {
      driver_id: true,
      driver_name: true,
      status: true,
      trips: {
        where: { status: { in: activeStatuses } },
        select: { trip_id: true }
      }
    });
    
    const onTrip = drivers.filter(d => d.trips.length > 0);
    const available = drivers.filter(d => d.trips.length === 0 && d.status === 'available');
    const inactive = drivers.filter(d => d.status === 'inactive');
    
    console.log('Total drivers:', drivers.length);
    console.log('On Trip:', onTrip.length);
    console.log('Available:', available.length);
    console.log('Inactive:', inactive.length);
    
    const onTripNoActive = drivers.filter(d => d.status === 'on_trip' && d.trips.length === 0);
    console.log('Drivers with status=on_trip but NO active trips:', onTripNoActive.length);
    
    const activeTripNotOnTrip = drivers.filter(d => d.trips.length > 0 && d.status !== 'on_trip');
    console.log('Drivers with active trips but status != on_trip:', activeTripNotOnTrip.length);
    
    await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });