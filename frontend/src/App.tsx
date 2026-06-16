import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ClusterPage } from "./pages/ClusterPage";
import { Dashboard } from "./pages/Dashboard";
import { ForecastPage } from "./pages/ForecastPage";
import { StorePage } from "./pages/StorePage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="recommendations" element={<StorePage />} />
        <Route path="clusters" element={<ClusterPage />} />
        <Route path="analysis" element={<ForecastPage />} />
        <Route path="store" element={<Navigate to="/recommendations" replace />} />
        <Route path="forecast" element={<Navigate to="/analysis" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
