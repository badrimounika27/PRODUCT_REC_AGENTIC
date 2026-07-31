import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { AssistantPage } from "./pages/AssistantPage";
import { ClusterPage } from "./pages/ClusterPage";
import { CustomerDetailPage } from "./pages/CustomerDetailPage";
import { CustomerSegmentsPage } from "./pages/CustomerSegmentsPage";
import { CustomersPage } from "./pages/CustomersPage";
import { Dashboard } from "./pages/Dashboard";
import { ForecastPage } from "./pages/ForecastPage";
import { FunnelPage } from "./pages/FunnelPage";
import { LoginPage } from "./pages/LoginPage";
import { StorePage } from "./pages/StorePage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="recommendations" element={<StorePage />} />
        <Route path="clusters" element={<ClusterPage />} />
        <Route path="analysis" element={<ForecastPage />} />
        <Route path="assistant" element={<AssistantPage />} />
        {/* B2C — customer behavior */}
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/segments" element={<CustomerSegmentsPage />} />
        <Route path="customers/:userId" element={<CustomerDetailPage />} />
        <Route path="analytics/funnel" element={<FunnelPage />} />
        {/* Legacy redirects */}
        <Route path="store" element={<Navigate to="/recommendations" replace />} />
        <Route path="forecast" element={<Navigate to="/analysis" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
