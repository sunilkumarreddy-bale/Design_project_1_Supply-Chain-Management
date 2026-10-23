import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNotificationsQuery, useReadAllNotificationsMutation, useReadNotificationMutation } from '../api/admin';
import { useAppDispatch, useAppSelector } from '../app/store';
import { resetLiveUnread } from '../features/notifications/notificationsSlice';
import { dateTime } from '../utils/format';

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data, isFetching, isError, refetch } = useNotificationsQuery({ limit: 8 });
  const [readOne] = useReadNotificationMutation();
  const [readAll, { isLoading: readingAll }] = useReadAllNotificationsMutation();
  const live = useAppSelector((s) => s.notifications.liveUnread);
  const dispatch = useAppDispatch();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isFetching) dispatch(resetLiveUnread());
  }, [isFetching, data, dispatch]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unread = (data?.unread ?? 0) + live;
  return (
    <div className="bell" ref={ref}>
      <button type="button" className="btn btn-icon bell-btn" aria-label={`Notifications, ${unread} unread`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden>🔔</span>
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-menu" role="menu">
          <div className="bell-head">
            <strong>Notifications</strong>
            <button type="button" className="btn btn-sm btn-ghost" disabled={!unread || readingAll} onClick={() => readAll()}>
              {readingAll ? 'Saving...' : 'Mark all read'}
            </button>
          </div>
          {isError && (
            <div className="banner banner-error">
              <div className="banner-body">Could not load notifications.</div>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => refetch()}>
                Retry
              </button>
            </div>
          )}
          {!isError && !data?.items.length && <div className="muted pad">{isFetching ? 'Loading...' : 'You are all caught up.'}</div>}
          <ul>
            {data?.items.map((n) => (
              <li key={n._id} className={n.readAt ? '' : 'unread'}>
                <Link
                  to={n.link || '/'}
                  role="menuitem"
                  onClick={() => {
                    if (!n.readAt) readOne(n._id);
                    setOpen(false);
                  }}
                >
                  <span className="bell-subject">{n.subject}</span>
                  <span className="bell-body">{n.body}</span>
                  <span className="bell-time">{dateTime(n.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
