import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useDnaStatsQuery } from '../../api/dna';
import QueryState from '../QueryState';
import StatCard from '../StatCard';
import { humanize, number, rupees } from '../../utils/format';

/** Dashboard cards from Stock DNA: alive lots, deaths this month by cause, value lost this month. */
export default function DnaCards() {
  const q = useDnaStatsQuery();
  const s = q.data;
  return (
    <QueryState error={q.error} onRetry={q.refetch}>
      <div className="grid grid-3">
        <StatCard
          label="Alive lots"
          value={number(s?.alive, 0)}
          hint={s ? `${s.expiringSoon} expiring within 7 days${s.recalledAlive ? `, ${s.recalledAlive} recalled` : ''}` : undefined}
          tone={s?.recalledAlive ? 'danger' : undefined}
          loading={q.isLoading}
          to="/dna"
        />
        <div className="card stat-card">
          <div className="stat-label">Died this month, by cause</div>
          {s && s.diedThisMonthByCause.length ? (
            <div style={{ height: 90 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s.diedThisMonthByCause.map((d) => ({ ...d, label: humanize(d.cause) }))} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 4 }}>
                  <XAxis type="number" allowDecimals={false} hide />
                  <YAxis type="category" dataKey="label" width={96} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [`${v} lot(s)`, 'Died']} />
                  <Bar dataKey="count" fill="#26365b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="stat-value">{q.isLoading ? '…' : '0'}</div>
          )}
        </div>
        <StatCard
          label="Value lost to expiry and damage this month"
          value={rupees(s?.valueLostThisMonth.total ?? 0, true)}
          hint={s ? `expiry ${rupees(s.valueLostThisMonth.expired, true)} · damage ${rupees(s.valueLostThisMonth.damaged, true)}` : undefined}
          tone={s && s.valueLostThisMonth.total > 0 ? 'warning' : undefined}
          loading={q.isLoading}
          to="/dna?alive=false"
        />
      </div>
    </QueryState>
  );
}
