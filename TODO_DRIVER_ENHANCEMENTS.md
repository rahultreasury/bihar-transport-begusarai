# Driver Management Enhancements Plan

## Issue 1: "Unknown" Driver Name
**Root Cause**: `AdminDrivers.jsx` line: `{r.driver_name || 'Unknown'}` — fallback to "Unknown" when name is missing.
**Fix**: Keep `r.driver_name || 'D'` (just initial fallback). No change needed since only name+mobile is required now, so if name exists it'll show it.

## Issue 2: Unique Mobile Number Check
**Files**: `DriverManagementService.js` + `AdminDrivers.jsx` + `DriverRegisterModal.jsx`
**Fix**:
- Backend: Add check in `registerDriver()` to find existing driver by mobile before creating. Return `{ success: false, message: 'Driver already exists', data: { driver_id, driver_name, driver_code } }` for the frontend to display.
- Frontend: In `DriverRegisterModal.jsx`, handle the 409/400 response with "Driver already exists" message showing existing driver name + ID + "Open Existing Driver" button.

## Issue 3: Improved Three-Dot Menu
**File**: `AdminDrivers.jsx` (the ActionMenuItem render)
**Fix**: Group actions into:
- **Driver** (View Profile, Edit Driver)
- **Finance** (Add Advance, Record Payment, Assign Vehicle)
- **Contact** (Call Driver, WhatsApp)
- **Danger** (Delete Driver)
Add section headers and better icons.

## Issue 4: Dashboard - Latest Drivers
**File**: `AdminDashboard.jsx`
**Fix**: Add a "Recently Added Drivers" section below the KPI cards. Fetch from `getDriverStats()` or a new endpoint.

## Issue 5: Driver Table Display
**File**: `AdminDrivers.jsx` (columns render)
**Fix**: Ensure avatar + name + driver ID + mobile are displayed clearly.

## Issue 6: Balance Display - ₹0
**File**: `AdminDrivers.jsx` (balance column)
**Fix**: Change `if (balance === 0) return <span>—</span>` to `return <span>₹0</span>`.

## Issue 7: Status Badges
**File**: `DriverStatusBadge.jsx`
**Fix**: Add "waiting" status with appropriate icon/color.

## Issue 8: Overall Quality
**File**: Multiple
**Fix**: Polish and consistency improvements.

