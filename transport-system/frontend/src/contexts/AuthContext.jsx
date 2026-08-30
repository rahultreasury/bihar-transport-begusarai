import { createContext } from 'react';

// AuthContext is defined in a separate module so React Fast Refresh
// does not treat App.jsx as both a component and a context exporter.
export const AuthContext = createContext(null);
