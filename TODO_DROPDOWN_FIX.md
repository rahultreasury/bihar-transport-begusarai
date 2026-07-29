# Dropdown Menu Fix - Progress Tracker

## Root Cause Analysis
1. **`overflow-hidden` on PremiumTable** clips the absolutely-positioned dropdown menu
2. **Shared `menuRef`** across all rows makes outside-click detection unreliable
3. **Missing `e.stopPropagation()`** on ActionMenuItem onClicks allows row handlers to interfere

## Steps
- [x] Step 1: Analyze code and identify root causes
- [x] Step 2: Create implementation plan
- [ ] Step 3: Fix PremiumTable.jsx - Remove overflow-hidden
- [ ] Step 4: Fix AdminDrivers.jsx - Replace shared menuRef with data-attribute approach
- [ ] Step 5: Fix AdminDrivers.jsx - Add stopPropagation to ActionMenuItem buttons
- [ ] Step 6: Fix AdminDrivers.jsx - Add ESC key handler for menu close
- [ ] Step 7: Verify no console errors and all actions work

