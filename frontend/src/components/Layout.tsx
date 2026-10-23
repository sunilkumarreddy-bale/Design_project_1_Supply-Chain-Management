import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/base';
import { useWarehousesQuery } from '../api/inventory';
import { useAppDispatch, useAppSelector } from '../app/store';
import { logout, setSelectedWarehouse } from '../features/auth/authSlice';
import { NAV, ROLE_LABEL } from '../utils/roles';
import NotificationBell from './NotificationBell';

function WarehouseSelector() {
  const selected = useAppSelector((s) => s.auth.selectedWarehouse);
  const dispatch = useAppDispatch();
  const { data } = useWarehousesQuery();
  return (
    <label className="topbar-select">
      <span className="sr-only">Warehouse</span>
      <select value={selected} onChange={(e) => dispatch(setSelectedWarehouse(e.target.value))} aria-label="Warehouse filter">
        <option value="">All warehouses</option>
        {data?.items
          .filter((w) => w.isActive)
          .map((w) => (
            <option key={w._id} value={w._id}>
              {w.code} · {w.name}
            </option>
          ))}
      </select>
    </label>
  );
}

export default function Layout() {
  const user = useAppSelector((s) => s.auth.user)!;
  const status = useAppSelector((s) => s.realtime.status);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const signOut = () => {
    dispatch(logout());
    dispatch(api.util.resetApiState());
    navigate('/login', { replace: true });
  };

  const items = NAV.filter((n) => n.roles.includes(user.role));
  return (
    <div className={`shell${menuOpen ? ' menu-open' : ''}`}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ◈
          </span>
          <span>
            Smart Inventory
            <small>Supply chain control</small>
          </span>
        </div>
        <nav>
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <span className="nav-icon" aria-hidden>
                {n.icon}
              </span>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="overlay" onClick={() => setMenuOpen(false)} aria-hidden />
      <div className="main-col">
        <header className="topbar">
          <button type="button" className="btn btn-icon hamburger" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            ☰
          </button>
          <div className="topbar-left">
            {user.role === 'admin' ? (
              <WarehouseSelector />
            ) : user.warehouse ? (
              <span className="topbar-scope">
                {user.warehouse.code} · {user.warehouse.name}
              </span>
            ) : user.supplier ? (
              <span className="topbar-scope">{user.supplier.name}</span>
            ) : null}
          </div>
          <div className="topbar-right">
            <span className={`live-dot ${status}`} title={status === 'connected' ? 'Live updates on' : status === 'connecting' ? 'Connecting...' : 'Live updates off'}>
              <span className="sr-only">Live updates {status}</span>
            </span>
            <NotificationBell />
            <span className="user-chip">
              <span className="user-name">{user.name}</span>
              <span className={`badge badge-role role-${user.role}`}>{ROLE_LABEL[user.role]}</span>
            </span>
            <button type="button" className="btn btn-sm" onClick={signOut}>
              Logout
            </button>
          </div>
        </header>
        <main id="main" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
