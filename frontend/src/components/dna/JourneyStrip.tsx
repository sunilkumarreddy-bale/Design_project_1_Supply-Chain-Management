import type { JourneyStop } from '../../types';
import { date, number } from '../../utils/format';

/** Warehouse hops as a strip: each stop with its dwell days, transit time between stops. */
export default function JourneyStrip({ stops }: { stops: JourneyStop[] }) {
  if (!stops.length) return <p className="muted">No location history yet.</p>;
  return (
    <ol className="journey" aria-label="Journey">
      {stops.map((s, i) => (
        <li key={`${s.warehouse._id}-${i}`} className="journey-stop">
          {s.transitDaysBefore !== null && <span className="journey-transit">{number(s.transitDaysBefore)} d in transit →</span>}
          <div className="journey-box">
            <strong>{s.warehouse.code}</strong>
            <span className="small">{s.warehouse.name}</span>
            <span className="small">
              {date(s.arrivedAt)} → {s.departedAt ? date(s.departedAt) : 'now'}
            </span>
            <span className="journey-dwell">{number(s.dwellDays)} days</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
