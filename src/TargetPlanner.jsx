import { useState } from 'react';

const API = 'http://localhost:8000';

const STATUS_COLOURS = {
  AHEAD: '#22c55e',
  ON_TRACK: '#38bdf8',
  BEHIND: '#f59e0b',
  DANGER: '#ef4444',
  COMPLETE: '#a78bfa',
};

const QUALITY_COLOURS = {
  HIGH: '#22c55e',
  MEDIUM: '#f59e0b',
  LOW: '#f97316',
  NONE: '#ef4444',
};

function formatMoney(value) {
  return `NGN ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
}

function formatDays(low, mid, high) {
  if (low === high) {
    return `${mid} day${mid === 1 ? '' : 's'}`;
  }
  return `${low}-${high} days (mid ${mid})`;
}

function ConfidenceBand({ low, mid, high }) {
  const max = Math.max(high, 1);
  const left = (low / max) * 100;
  const width = ((high - low) / max) * 100;
  const midpoint = (mid / max) * 100;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 10, color: '#555', marginBottom: 4 }}>
        Est. {formatDays(low, mid, high)}
      </div>
      <div style={{ position: 'relative', height: 6, background: '#1e1e1e', borderRadius: 999 }}>
        <div style={{
          position: 'absolute',
          left: `${left}%`,
          width: `${width}%`,
          height: '100%',
          background: '#38bdf844',
          borderRadius: 999,
        }} />
        <div style={{
          position: 'absolute',
          left: `${midpoint}%`,
          width: 4,
          height: '100%',
          background: '#38bdf8',
          borderRadius: 999,
        }} />
      </div>
    </div>
  );
}

function MilestoneCard({ milestone, index }) {
  const [expanded, setExpanded] = useState(false);
  const qualityColour = QUALITY_COLOURS[milestone.data_quality] || '#888';

  return (
    <div
      onClick={() => setExpanded((value) => !value)}
      style={{
        background: '#0f1720',
        border: '1px solid #38bdf822',
        borderLeft: '3px solid #38bdf866',
        borderRadius: 8,
        padding: '12px 14px',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#555' }}>M{index + 1}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#f0f0f0' }}>
            {formatMoney(milestone.capital_start)} to {formatMoney(milestone.capital_end)}
          </span>
          <span style={{
            fontSize: 11,
            color: '#38bdf8',
            border: '1px solid #38bdf844',
            background: '#38bdf822',
            borderRadius: 999,
            padding: '2px 8px',
          }}>
            {milestone.lot_size} lot
          </span>
          <span style={{
            fontSize: 10,
            color: qualityColour,
            border: `1px solid ${qualityColour}44`,
            background: `${qualityColour}22`,
            borderRadius: 999,
            padding: '2px 8px',
          }}>
            {milestone.data_quality}
          </span>
        </div>
        <span style={{ fontSize: 12, color: '#38bdf8' }}>
          {formatDays(milestone.est_days_low, milestone.est_days_mid, milestone.est_days_high)}
        </span>
      </div>

      <ConfidenceBand
        low={milestone.est_days_low}
        mid={milestone.est_days_mid}
        high={milestone.est_days_high}
      />

      {expanded && (
        <div style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: '1px solid #1e1e1e',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
        }}>
          {[
            ['Planner Pair', milestone.pair],
            ['Daily Target', formatMoney(milestone.daily_target_ngn)],
            ['Daily Pips', milestone.daily_target_pips],
            ['Min Trades', milestone.min_trades_per_day],
            ['Max Trades', milestone.max_trades_per_day],
            ['Loss Survival', milestone.consecutive_loss_survival],
          ].map(([label, value]) => (
            <div key={label}>
              <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0', marginTop: 2 }}>{value}</div>
            </div>
          ))}
          {milestone.overrides_applied?.length > 0 && (
            <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#f59e0b' }}>
              Manual overrides: {milestone.overrides_applied.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KPICard({ label, actual, target, unit, colour }) {
  const ratio = target > 0 ? Math.max(Math.min((actual / target) * 100, 100), 0) : 0;

  return (
    <div style={{
      flex: 1,
      minWidth: 160,
      background: '#111',
      border: '1px solid #1e1e1e',
      borderRadius: 8,
      padding: '12px 14px',
    }}>
      <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: colour }}>
        {unit}{Number(actual || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
      </div>
      <div style={{ fontSize: 11, color: '#444', marginTop: 2 }}>
        Target: {unit}{Number(target || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
      </div>
      <div style={{ width: '100%', background: '#1e1e1e', borderRadius: 999, height: 4, marginTop: 8 }}>
        <div style={{ width: `${ratio}%`, height: '100%', background: colour, borderRadius: 999, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}

function OverrideInput({ label, value, suffix, onChange, onClear }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: '#aaa' }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="number"
          value={value}
          onChange={onChange}
          style={{
            width: 110,
            background: '#0a0a0a',
            border: '1px solid #f59e0b55',
            color: '#f59e0b',
            borderRadius: 6,
            padding: '5px 8px',
            fontSize: 12,
          }}
        />
        {suffix && <span style={{ fontSize: 11, color: '#666' }}>{suffix}</span>}
        <button
          onClick={onClear}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#ef4444',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

export default function TargetPlanner({ settings }) {
  const [subTab, setSubTab] = useState('path');
  const [targetInput, setTargetInput] = useState('');
  const [planData, setPlanData] = useState(null);
  const [kpiData, setKpiData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [error, setError] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [showOverrides, setShowOverrides] = useState(false);

  const balance = Number(settings?.balance || 150000);
  const dailyLossPct = Number(settings?.dailyLossPct || 2) / 100;
  const riskPct = Number(settings?.riskPct || 1) / 100;
  const parsedTarget = Number(targetInput);
  const hasValidTarget = Number.isFinite(parsedTarget) && parsedTarget > balance;
  const planMatchesInput = planData && Number(planData.target_ngn) === parsedTarget;
  const activePlan = planMatchesInput ? planData : null;
  const totalTradingDays = activePlan?.history_stats?.total_trading_days || 0;
  const noHistory = Boolean(activePlan?.history_stats?.no_history);
  const veryThinHistory = totalTradingDays > 0 && totalTradingDays < 3;
  const lowData = totalTradingDays >= 3 && Boolean(activePlan?.history_stats?.low_data_warning);

  const setOverride = (key, scale = 1) => (event) => {
    const raw = event.target.value;
    if (raw === '') {
      setOverrides((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }

    setOverrides((current) => ({
      ...current,
      [key]: Number(raw) / scale,
    }));
  };

  const clearOverride = (key) => () => {
    setOverrides((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const fetchPlan = async () => {
    if (!hasValidTarget) {
      setError('Target must be greater than your current balance.');
      return;
    }

    setLoading(true);
    setError(null);
    setKpiData(null);

    try {
      const response = await fetch(`${API}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_ngn: parsedTarget,
          balance,
          daily_loss_pct: dailyLossPct,
          risk_pct: riskPct,
          overrides,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error ${response.status}`);
      }

      const json = await response.json();
      if (json.error) {
        throw new Error(json.error);
      }

      setPlanData(json);
      if ((json.history_stats?.total_trading_days || 0) < 3) {
        setShowOverrides(true);
      }
    } catch (fetchError) {
      setError(fetchError.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchKPI = async () => {
    if (!hasValidTarget) {
      setError('Enter a target above your current balance before loading KPI data.');
      return;
    }

    setKpiLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        balance: String(balance),
        daily_loss_pct: String(dailyLossPct),
        risk_pct: String(riskPct),
        target_ngn: String(parsedTarget),
      });

      const response = await fetch(`${API}/kpi/today?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`API error ${response.status}`);
      }

      const json = await response.json();
      if (json.error) {
        throw new Error(json.error);
      }

      setKpiData(json);
    } catch (fetchError) {
      setError(fetchError.message);
    } finally {
      setKpiLoading(false);
    }
  };

  const openPath = () => setSubTab('path');
  const openKpi = () => {
    setSubTab('kpi');
    if (hasValidTarget) {
      fetchKPI();
    }
  };

  const subTabStyle = (active) => ({
    background: 'transparent',
    color: active ? '#f0f0f0' : '#555',
    border: 'none',
    borderBottom: `2px solid ${active ? '#38bdf8' : 'transparent'}`,
    padding: '6px 14px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  });

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid #1e1e1e', marginBottom: 20, gap: 4 }}>
        <button style={subTabStyle(subTab === 'path')} onClick={openPath}>Path</button>
        <button style={subTabStyle(subTab === 'kpi')} onClick={openKpi}>Daily KPI</button>
      </div>

      {subTab === 'path' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
            <span style={{ fontSize: 13, color: '#888' }}>Target</span>
            <span style={{ fontSize: 13, color: '#666' }}>NGN</span>
            <input
              type="number"
              placeholder="1000000"
              value={targetInput}
              onChange={(event) => {
                setTargetInput(event.target.value);
                setKpiData(null);
                setError(null);
              }}
              style={{
                background: '#111',
                border: '1px solid #333',
                color: '#e0e0e0',
                borderRadius: 6,
                padding: '7px 12px',
                fontSize: 14,
                width: 180,
              }}
            />
            <button
              onClick={fetchPlan}
              disabled={loading || !hasValidTarget}
              style={{
                background: hasValidTarget ? '#22c55e22' : '#1a1a1a',
                color: hasValidTarget ? '#22c55e' : '#555',
                border: `1px solid ${hasValidTarget ? '#22c55e' : '#333'}`,
                borderRadius: 6,
                padding: '7px 20px',
                cursor: loading || !hasValidTarget ? 'not-allowed' : 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {loading ? 'Planning...' : 'Generate Plan'}
            </button>
          </div>

          {!hasValidTarget && targetInput && (
            <div style={{ color: '#f59e0b', fontSize: 12, marginBottom: 14 }}>
              Enter a target greater than {formatMoney(balance)}.
            </div>
          )}

          {noHistory && (
            <div style={{ background: '#1a1200', border: '1px solid #f59e0b55', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#f59e0b' }}>
              No trade history found. Using estimated defaults. Adjust the overrides below to match your expectations.
            </div>
          )}

          {veryThinHistory && (
            <div style={{ background: '#1a1200', border: '1px solid #f59e0b55', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#f59e0b' }}>
              Only {totalTradingDays} trading day{totalTradingDays === 1 ? '' : 's'} of history found. Overrides are opened by default because estimates lean on fallback assumptions.
            </div>
          )}

          {lowData && (
            <div style={{ background: '#1a1200', border: '1px solid #f9731655', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#f97316' }}>
              Only {totalTradingDays} trading days of history are available. Confidence bands are widened to reflect limited data.
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <button
              onClick={() => setShowOverrides((value) => !value)}
              style={{
                background: 'transparent',
                color: '#555',
                border: '1px solid #2a2a2a',
                borderRadius: 6,
                padding: '4px 12px',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              {showOverrides ? 'Hide' : 'Show'} manual overrides {Object.keys(overrides).length > 0 ? `(${Object.keys(overrides).length} active)` : ''}
            </button>

            {showOverrides && (
              <div style={{
                background: '#111',
                border: '1px solid #2a2a2a',
                borderRadius: 8,
                padding: '14px',
                marginTop: 8,
                display: 'flex',
                gap: 20,
                flexWrap: 'wrap',
              }}>
                <OverrideInput
                  label="Win Rate"
                  value={overrides.win_rate !== undefined ? overrides.win_rate * 100 : 50}
                  suffix="%"
                  onChange={setOverride('win_rate', 100)}
                  onClear={clearOverride('win_rate')}
                />
                <OverrideInput
                  label="Avg Win (NGN)"
                  value={overrides.avg_win_ngn !== undefined ? overrides.avg_win_ngn : 2000}
                  onChange={setOverride('avg_win_ngn')}
                  onClear={clearOverride('avg_win_ngn')}
                />
                <OverrideInput
                  label="Avg Loss (NGN)"
                  value={overrides.avg_loss_ngn !== undefined ? overrides.avg_loss_ngn : 1500}
                  onChange={setOverride('avg_loss_ngn')}
                  onClear={clearOverride('avg_loss_ngn')}
                />
                <div style={{ alignSelf: 'flex-end' }}>
                  <button
                    onClick={fetchPlan}
                    style={{
                      background: '#f59e0b22',
                      color: '#f59e0b',
                      border: '1px solid #f59e0b',
                      borderRadius: 6,
                      padding: '6px 14px',
                      cursor: 'pointer',
                      fontSize: 11,
                    }}
                  >
                    Recalculate
                  </button>
                </div>
              </div>
            )}
          </div>

          {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{error}</div>}

          {activePlan && (
            <div style={{
              display: 'flex',
              gap: 18,
              flexWrap: 'wrap',
              padding: '10px 14px',
              background: '#111',
              border: '1px solid #1e1e1e',
              borderRadius: 8,
              marginBottom: 16,
            }}>
              <div>
                <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Planner Pair</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#f0f0f0' }}>{activePlan.planning_symbol}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Balance</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#f0f0f0' }}>{formatMoney(activePlan.balance_ngn)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Target</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#22c55e' }}>{formatMoney(activePlan.target_ngn)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>History Days</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#38bdf8' }}>{totalTradingDays}</div>
              </div>
            </div>
          )}

          {activePlan?.milestones?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: '#444', marginBottom: 2 }}>
                {activePlan.milestones.length} milestone{activePlan.milestones.length !== 1 ? 's' : ''} to reach {formatMoney(parsedTarget)}
              </div>
              {activePlan.milestones.map((milestone, index) => (
                <MilestoneCard key={`${milestone.capital_start}-${milestone.capital_end}`} milestone={milestone} index={index} />
              ))}
            </div>
          )}

          {activePlan && activePlan.milestones?.length === 0 && (
            <div style={{ color: '#444', fontSize: 13, textAlign: 'center', paddingTop: 20 }}>
              No milestones were generated for this target.
            </div>
          )}
        </div>
      )}

      {subTab === 'kpi' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#555' }}>
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
            <button
              onClick={fetchKPI}
              disabled={kpiLoading || !hasValidTarget}
              style={{
                background: '#1e1e1e',
                color: hasValidTarget ? '#e0e0e0' : '#555',
                border: '1px solid #333',
                borderRadius: 6,
                padding: '5px 14px',
                cursor: kpiLoading || !hasValidTarget ? 'not-allowed' : 'pointer',
                fontSize: 11,
              }}
            >
              {kpiLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{error}</div>}

          {!hasValidTarget && (
            <div style={{ color: '#444', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
              Enter a target above your current balance in the Path tab before loading KPI data.
            </div>
          )}

          {hasValidTarget && !kpiLoading && !kpiData && (
            <div style={{ color: '#444', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
              Open the Path tab to generate a plan, or refresh here to load today&apos;s KPI snapshot for the current target.
            </div>
          )}

          {hasValidTarget && !kpiLoading && kpiData && !kpiData.current_milestone && (
            <div style={{ color: '#444', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
              No active milestone is available for this target yet.
            </div>
          )}

          {kpiData?.kpi && Object.keys(kpiData.kpi).length > 0 && (() => {
            const kpi = kpiData.kpi;
            const statusColour = STATUS_COLOURS[kpi.status] || '#888';

            return (
              <>
                <div style={{
                  background: `${statusColour}15`,
                  border: `1px solid ${statusColour}44`,
                  borderRadius: 8,
                  padding: '10px 16px',
                  marginBottom: 16,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                }}>
                  <span style={{ fontWeight: 700, color: statusColour, fontSize: 14 }}>{kpi.status}</span>
                  <span style={{ fontSize: 12, color: '#888' }}>{kpi.pct_of_target}% of daily target</span>
                </div>

                <div style={{
                  display: 'flex',
                  gap: 18,
                  flexWrap: 'wrap',
                  padding: '10px 14px',
                  background: '#111',
                  border: '1px solid #1e1e1e',
                  borderRadius: 8,
                  marginBottom: 16,
                }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Planner Pair</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#f0f0f0' }}>{kpiData.planning_symbol}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Milestone Range</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#f0f0f0' }}>
                      {formatMoney(kpiData.current_milestone.capital_start)} to {formatMoney(kpiData.current_milestone.capital_end)}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                  <KPICard
                    label="P&L Today"
                    actual={kpi.actual_ngn}
                    target={kpi.target_ngn}
                    unit="NGN "
                    colour={kpi.actual_ngn >= 0 ? '#22c55e' : '#ef4444'}
                  />
                  <KPICard
                    label="Pips Today"
                    actual={kpi.actual_pips}
                    target={kpi.target_pips}
                    unit=""
                    colour="#38bdf8"
                  />
                </div>

                <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Trades</div>
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    {[
                      ['Taken', kpi.trades_taken, '#f0f0f0'],
                      ['Remaining', kpi.trades_remaining, '#38bdf8'],
                      ['Min', kpi.min_trades, '#22c55e'],
                      ['Max', kpi.max_trades, '#f59e0b'],
                    ].map(([label, value, colour]) => (
                      <div key={label}>
                        <div style={{ fontSize: 10, color: '#555' }}>{label}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: colour }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {kpi.status === 'DANGER' && (
                  <div style={{ marginTop: 12, background: '#2a0d0d', border: '1px solid #ef444455', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 12 }}>
                    Daily loss limit reached at {formatMoney(kpi.daily_limit_ngn)}. Stop trading for today.
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
