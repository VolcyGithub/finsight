import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import { Toaster } from "@/components/ui/sonner";

import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Transactions from "@/pages/Transactions";
import Upload from "@/pages/Upload";
import Insights from "@/pages/Insights";
import Alerts from "@/pages/Alerts";
import Settings from "@/pages/Settings";
import Invoices from "@/pages/Invoices";
import Contacts from "@/pages/Contacts";
import Accounting from "@/pages/Accounting";
import Reports from "@/pages/Reports";
import Reconciliation from "@/pages/Reconciliation";

const Protected = ({ children }) => (
  <ProtectedRoute>
    <AppLayout>{children}</AppLayout>
  </ProtectedRoute>
);

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Protected><Dashboard /></Protected>} />
            <Route path="/invoices" element={<Protected><Invoices /></Protected>} />
            <Route path="/contacts" element={<Protected><Contacts /></Protected>} />
            <Route path="/accounting" element={<Protected><Accounting /></Protected>} />
            <Route path="/reports" element={<Protected><Reports /></Protected>} />
            <Route path="/reconcile" element={<Protected><Reconciliation /></Protected>} />
            <Route path="/transactions" element={<Protected><Transactions /></Protected>} />
            <Route path="/upload" element={<Protected><Upload /></Protected>} />
            <Route path="/insights" element={<Protected><Insights /></Protected>} />
            <Route path="/alerts" element={<Protected><Alerts /></Protected>} />
            <Route path="/settings" element={<Protected><Settings /></Protected>} />
          </Routes>
          <Toaster position="top-right" richColors />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
