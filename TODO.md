- [ ] Locate current WhatsApp owner/customer flow in transport-system/backend/services/BookingService.js
- [ ] Wrap only customer WhatsApp send in its own try/catch
- [ ] Ensure owner WhatsApp send code remains unchanged
- [ ] In customer catch: log only console.warn("[booking][customer] WhatsApp skipped:", err.message)
- [ ] Ensure customer WhatsApp failures do not throw / do not affect API or SQLite
- [ ] Verify code compiles (optional: run node syntax check)

