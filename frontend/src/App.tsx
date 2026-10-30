import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import ToastContainer from './components/Toast';
import AuthBootstrap from './features/auth/AuthBootstrap';
import SocketManager from './features/realtime/SocketManager';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Forbidden from './pages/Forbidden';
import NotFound from './pages/NotFound';
import Profile from './pages/Profile';
import { ALL, INTERNAL, MANAGERS } from './utils/roles';

const Products = lazy(() => import('./pages/Products'));
const Warehouses = lazy(() => import('./pages/Warehouses'));
const Stock = lazy(() => import('./pages/Stock'));
const Scan = lazy(() => import('./pages/Scan'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'));
const Transfers = lazy(() => import('./pages/Transfers'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Insights = lazy(() => import('./pages/Insights'));
const Recovery = lazy(() => import('./pages/Recovery'));
const RecoveryPlanDetail = lazy(() => import('./pages/RecoveryPlanDetail'));
const Redistribution = lazy(() => import('./pages/Redistribution'));
const Simulator = lazy(() => import('./pages/Simulator'));
const CustomerOrders = lazy(() => import('./pages/CustomerOrders'));
const CycleCounts = lazy(() => import('./pages/CycleCounts'));
const Reports = lazy(() => import('./pages/Reports'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const Users = lazy(() => import('./pages/Users'));
const StockDna = lazy(() => import('./pages/StockDna'));
const LotDetail = lazy(() => import('./pages/LotDetail'));
const LotLabel = lazy(() => import('./pages/LotLabel'));
const RecallTrace = lazy(() => import('./pages/RecallTrace'));

const guard = (roles: typeof ALL, el: JSX.Element) => <ProtectedRoute roles={roles}>{el}</ProtectedRoute>;

export default function App() {
  return (
    <>
      <AuthBootstrap />
      <SocketManager />
      <ToastContainer />
      <Suspense fallback={<div className="page-loading">Loading...</div>}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="products" element={guard(INTERNAL, <Products />)} />
            <Route path="warehouses" element={guard(INTERNAL, <Warehouses />)} />
            <Route path="stock" element={guard(INTERNAL, <Stock />)} />
            <Route path="scan" element={guard(INTERNAL, <Scan />)} />
            <Route path="dna" element={guard(ALL, <StockDna />)} />
            <Route path="dna/recall-trace" element={guard(MANAGERS, <RecallTrace />)} />
            <Route path="dna/:id" element={guard(ALL, <LotDetail />)} />
            <Route path="dna/:id/label" element={guard(ALL, <LotLabel />)} />
            <Route path="suppliers" element={guard(['admin', 'warehouse_manager', 'supplier'], <Suppliers />)} />
            <Route path="purchase-orders" element={guard(ALL, <PurchaseOrders />)} />
            <Route path="transfers" element={guard(INTERNAL, <Transfers />)} />
            <Route path="alerts" element={guard(INTERNAL, <Alerts />)} />
            <Route path="insights" element={guard(MANAGERS, <Insights />)} />
            <Route path="recovery" element={guard(MANAGERS, <Recovery />)} />
            <Route path="recovery/:id" element={guard(MANAGERS, <RecoveryPlanDetail />)} />
            <Route path="redistribution" element={guard(MANAGERS, <Redistribution />)} />
            <Route path="simulator" element={guard(MANAGERS, <Simulator />)} />
            <Route path="orders" element={guard(MANAGERS, <CustomerOrders />)} />
            <Route path="counts" element={guard(INTERNAL, <CycleCounts />)} />
            <Route path="reports" element={guard(['admin', 'warehouse_manager', 'supplier'], <Reports />)} />
            <Route path="audit" element={guard(MANAGERS, <AuditLog />)} />
            <Route path="users" element={guard(['admin'], <Users />)} />
            <Route path="profile" element={<Profile />} />
            <Route path="forbidden" element={<Forbidden />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
