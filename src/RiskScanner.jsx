import { useState, useEffect, useMemo } from 'react';

const API = 'http://localhost:8000';

const DEFAULT_SETTINGS = {
  balance:       150000,
  dailyLossPct:  2,
  riskPct:       1,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem('riskScannerSettings');
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

const CLASS_COLOURS = {
  SAFE:     { bg: '#0d2e1a', border: '#22c55e', text: '#22c55e' },
  MODERATE: { bg: '#2a1f00', border: '#f59e0b', text: '#f59e0b' },
  RISKY:    { bg: '#2a0d0d', border: '#ef4444', text: '#ef4444' },
};

const LABEL_COLOURS = {
  GREEN: '#22c55e',
  AMBER: '#f59e0b',
  RED:   '#ef4444',
};

const DIM_NAMES = {
  sd_position:      'SD Position',
  trend_strength:   'Trend',
  volatility:       'Volatility',
  liquidity:        'Liquidity',
  capital_exposure: 'Capital Risk',
};

const CLASS_BADGE_COLOURS = {
  crypto:  '#818cf8',
  forex:   '#38bdf8',
  metals:  '#fbbf24',
  indices: '#a78bfa',
};

function Badge({ label, colour }) {
  return (
    <span style={{
      background: colour + '22', color: colour,
      border: `1px solid ${colour}55`, borderRadius: 4,
      padding: '1px 7px', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
    }}>
      {label}
    </span>
  );
}

function DimPill({ label, value, description }) {
  const colour = LABEL_COLOURS[label] || '#888';
  return (
    <div title={description} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#aaa', cursor: 'default' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: colour, flexShrink: 0 }} />
      <span>{value}</span>
    </div>
  );
}

function ScoreBar({ score, classification }) {
  const colour = CLASS_COLOURS[classification]?.border || '#888';
  return (
    <div style={{ width: '100%', background: '#1e1e1e', borderRadius: 4, height: 4, marginTop: 6 }}>
      <div style={{ width: `${score}%`, height: '100%', background: colour, borderRadius: 4, transition: 'width 0.4s ease' }} />
    </div>
  );
}

function PairCard({ pair }) {
  const [expanded, setExpanded] = useState(false);
  const c = CLASS_COLOURS[pair.classification] || CLASS_COLOURS.RISKY;
  const badgeColour = CLASS_BADGE_COLOURS[pair.asset_class] || '#888';
  const dims = pair.dimensions;

  return (
    <div onClick={() => setExpanded(e => !e)} style={{
      background: c.bg, border: `1px solid ${c.border}33`,
      borderLeft: `3px solid ${c.border}`, borderRadius: 8,
      padding: '12px 14px', cursor: 'pointer', transition: 'border-color 0.2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#f0f0f0' }}>{pair.symbol}</span>
          <Badge label={pair.class_label} colour={badgeColour} />
          <span style={{ fontSize: 11, color: '#666' }}>#{pair.class_rank}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: '#aaa' }}>
            {pair.price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })}
          </span>
          <span style={{ fontWeight: 700, fontSize: 13, color: c.text, minWidth: 60, textAlign: 'right' }}>
            {pair.score}/100
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: c.text, background: c.border + '22', padding: '2px 8px', borderRadius: 4 }}>
            {pair.classification}
          </span>
        </div>
      </div>

      <ScoreBar score={pair.score} classification={pair.classification} />

      <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        {Object.entries(DIM_NAMES).map(([key, name]) => {
          const d = dims[key];
          return (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{name}</span>
              <DimPill label={d.label} value={d.value} description={d.description} />
            </div>
          );
        })}
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: '1px solid #333', paddingTop: 10 }}>
          {Object.entries(DIM_NAMES).map(([key, name]) => {
            const d = dims[key];
            const colour = LABEL_COLOURS[d.label] || '#888';
            return (
              <div key={key} style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'flex-start', padding: '4px 0',
                borderBottom: '1px solid #1e1e1e', gap: 10,
              }}>
                <span style={{ color: '#888', fontSize: 12, minWidth: 110 }}>{name}</span>
                <span style={{ color: colour, fontSize: 11, fontWeight: 600, minWidth: 50 }}>{d.label}</span>
                <span style={{ color: '#999', fontSize: 11, textAlign: 'right' }}>{d.description}</span>
              </div>
            );
          })}
          {pair.red_flags?.length > 0 && (
            <div style={{ marginTop: 8, color: '#ef4444', fontSize: 11 }}>
              Gate failed: {pair.red_flags.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FilterButton({ label, active, colour, count, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: active ? (colour + '22') : 'transparent',
      color: active ? colour : '#666',
      border: `1px solid ${active ? colour : '#333'}`,
      borderRadius: 6, padding: '5px 14px', cursor: 'pointer',
      fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
      transition: 'all 0.15s',
    }}>
      {label}
      {count !== undefined && (
        <span style={{
          background: active ? colour + '33' : '#222',
          color: active ? colour : '#555',
          borderRadius: 10, padding: '0 6px', fontSize: 10,
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

function SettingRow({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, color: '#aaa', fontWeight: 600 }}>{label}</label>
      {hint && <span style={{ fontSize: 11, color: '#555' }}>{hint}</span>}
      {children}
    </div>
  );
}

function SettingsInput({ value, onChange, prefix, suffix, type = 'number', min, max, step }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {prefix && <span style={{ fontSize: 12, color: '#666' }}>{prefix}</span>}
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        min={min} max={max} step={step}
        style={{
          background: '#111', border: '1px solid #333', color: '#e0e0e0',
          borderRadius: 6, padding: '7px 10px', fontSize: 13, width: 120,
          outline: 'none',
        }}
      />
      {suffix && <span style={{ fontSize: 12, color: '#666' }}>{suffix}</span>}
    </div>
  );
}

function SettingsTab({ settings, onSave }) {
  const [local, setLocal] = useState({ ...settings });

  const set = (key) => (val) => setLocal(prev => ({ ...prev, [key]: val }));

  const isDirty = JSON.stringify(local) !== JSON.stringify(settings);

  return (
    <div style={{ maxWidth: 520 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: '#f0f0f0' }}>Settings</h2>
      <p style={{ margin: '0 0 28px', fontSize: 12, color: '#555' }}>
        Changes apply on next scan. Values are saved in your browser.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Account */}
        <div>
          <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
            Account
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 18px', background: '#111', borderRadius: 8, border: '1px solid #1e1e1e' }}>
            <SettingRow
              label="Account Balance"
              hint="MT5 shows ₦0 for this account — enter your actual balance here."
            >
              <SettingsInput prefix="₦" value={local.balance} onChange={set('balance')} min={0} step={1000} />
            </SettingRow>
          </div>
        </div>

        {/* Risk Rules */}
        <div>
          <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
            Risk Rules
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 18px', background: '#111', borderRadius: 8, border: '1px solid #1e1e1e' }}>
            <SettingRow
              label="Daily Loss Limit"
              hint="Maximum % of balance you allow yourself to lose in one day."
            >
              <SettingsInput value={local.dailyLossPct} onChange={set('dailyLossPct')} suffix="%" min={0.1} max={20} step={0.5} />
              <span style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>
                = ₦{(Number(local.balance) * Number(local.dailyLossPct) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} at current balance
              </span>
            </SettingRow>

            <SettingRow
              label="Risk Per Trade"
              hint="% of balance you risk on each individual trade (used to calculate recommended lot size)."
            >
              <SettingsInput value={local.riskPct} onChange={set('riskPct')} suffix="%" min={0.1} max={10} step={0.1} />
              <span style={{ fontSize: 11, color: '#38bdf8', marginTop: 2 }}>
                = ₦{(Number(local.balance) * Number(local.riskPct) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} per trade
              </span>
            </SettingRow>
          </div>
        </div>

        {/* Save */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={() => onSave(local)}
            style={{
              background: isDirty ? '#22c55e22' : '#1a1a1a',
              color: isDirty ? '#22c55e' : '#555',
              border: `1px solid ${isDirty ? '#22c55e' : '#333'}`,
              borderRadius: 6, padding: '8px 20px',
              cursor: isDirty ? 'pointer' : 'not-allowed',
              fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
            }}
          >
            Save &amp; Rescan
          </button>
          {!isDirty && <span style={{ fontSize: 11, color: '#444' }}>No unsaved changes</span>}
        </div>
      </div>
    </div>
  );
}

export default function RiskScanner() {
  const [settings, setSettings]    = useState(loadSettings);
  const [tab, setTab]              = useState('scanner');
  const [data, setData]            = useState(null);
  const [loading, setLoading]      = useState(false);
  const [error, setError]          = useState(null);
  const [activeClasses, setActive] = useState(new Set(['crypto', 'forex', 'metals', 'indices']));
  const [minScore, setMinScore]    = useState('0');
  const [maxScore, setMaxScore]    = useState('100');
  const [lastRefresh, setLast]     = useState(null);

  const fetchData = async (s = settings) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          balance:        Number(s.balance),
          daily_loss_pct: Number(s.dailyLossPct) / 100,
          risk_pct:       Number(s.riskPct) / 100,
        }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
      setLast(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSaveSettings = (newSettings) => {
    localStorage.setItem('riskScannerSettings', JSON.stringify(newSettings));
    setSettings(newSettings);
    setTab('scanner');
    fetchData(newSettings);
  };

  const toggleClass = (cls) => {
    setActive(prev => {
      const next = new Set(prev);
      if (next.has(cls)) { if (next.size > 1) next.delete(cls); }
      else next.add(cls);
      return next;
    });
  };

  const filtered = useMemo(() => {
    if (!data?.pairs) return [];
    return data.pairs.filter(p =>
      activeClasses.has(p.asset_class) &&
      p.score >= Number(minScore) && p.score <= Number(maxScore)
    );
  }, [data, activeClasses, minScore, maxScore]);

  const countByClass = useMemo(() => {
    if (!data?.pairs) return {};
    return data.pairs.reduce((acc, p) => {
      acc[p.asset_class] = (acc[p.asset_class] || 0) + 1;
      return acc;
    }, {});
  }, [data]);

  const classes = [
    { key: 'crypto',  label: 'Crypto',  colour: CLASS_BADGE_COLOURS.crypto },
    { key: 'forex',   label: 'Forex',   colour: CLASS_BADGE_COLOURS.forex },
    { key: 'metals',  label: 'Metals',  colour: CLASS_BADGE_COLOURS.metals },
    { key: 'indices', label: 'Indices', colour: CLASS_BADGE_COLOURS.indices },
  ];

  const TAB_STYLE = (active) => ({
    background: 'transparent',
    color: active ? '#f0f0f0' : '#555',
    border: 'none',
    borderBottom: `2px solid ${active ? '#22c55e' : 'transparent'}`,
    padding: '8px 16px', cursor: 'pointer',
    fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
  });

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0a0a', color: '#e0e0e0',
      fontFamily: "'Inter', 'Segoe UI', sans-serif", padding: '24px 20px',
    }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#f0f0f0' }}>Pair Risk Scanner</h1>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#555' }}>Capital preservation — Gate-and-Rank scoring</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <button onClick={() => fetchData()} disabled={loading} style={{
              background: '#1e1e1e', color: loading ? '#555' : '#e0e0e0',
              border: '1px solid #333', borderRadius: 6,
              padding: '6px 16px', cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 12, fontWeight: 600,
            }}>
              {loading ? 'Scanning…' : '↻ Refresh'}
            </button>
            {lastRefresh && <div style={{ fontSize: 11, color: '#444', marginTop: 4 }}>Last scan: {lastRefresh}</div>}
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1e1e1e', marginBottom: 20, gap: 4 }}>
          <button style={TAB_STYLE(tab === 'scanner')} onClick={() => setTab('scanner')}>Scanner</button>
          <button style={TAB_STYLE(tab === 'settings')} onClick={() => setTab('settings')}>⚙ Settings</button>
        </div>

        {/* Settings tab */}
        {tab === 'settings' && (
          <SettingsTab settings={settings} onSave={handleSaveSettings} />
        )}

        {/* Scanner tab */}
        {tab === 'scanner' && (
          <>
            {/* Summary strip */}
            {data && (
              <div style={{
                display: 'flex', gap: 20, marginBottom: 20,
                padding: '10px 16px', background: '#111', borderRadius: 8,
                border: '1px solid #1e1e1e', flexWrap: 'wrap',
              }}>
                <div>
                  <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Balance</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#f0f0f0' }}>₦{data.balance_ngn?.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Daily Limit</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#f59e0b' }}>₦{data.daily_limit_ngn?.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Risk / Trade</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#38bdf8' }}>₦{data.risk_per_trade?.toLocaleString()}</div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 16 }}>
                  {[
                    { label: 'Safe',     val: data.summary?.safe,     colour: '#22c55e' },
                    { label: 'Moderate', val: data.summary?.moderate, colour: '#f59e0b' },
                    { label: 'Risky',    val: data.summary?.risky,    colour: '#ef4444' },
                  ].map(({ label, val, colour }) => (
                    <div key={label} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: colour }}>{val}</div>
                      <div style={{ fontSize: 10, color: '#555' }}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Filters */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
              {classes.map(({ key, label, colour }) => (
                <FilterButton
                  key={key} label={label} active={activeClasses.has(key)}
                  colour={colour} count={countByClass[key]} onClick={() => toggleClass(key)}
                />
              ))}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#666' }}>
                <span>Score</span>
                <input type="number" min={0} max={100} value={minScore} onChange={e => setMinScore(e.target.value)}
                  style={{ width: 44, background: '#111', border: '1px solid #333', color: '#e0e0e0', borderRadius: 4, padding: '3px 6px', fontSize: 12 }} />
                <span style={{ color: '#444' }}>–</span>
                <input type="number" min={0} max={100} value={maxScore} onChange={e => setMaxScore(e.target.value)}
                  style={{ width: 44, background: '#111', border: '1px solid #333', color: '#e0e0e0', borderRadius: 4, padding: '3px 6px', fontSize: 12 }} />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                background: '#2a0d0d', border: '1px solid #ef444455',
                borderRadius: 8, padding: '12px 16px', color: '#ef4444',
                fontSize: 13, marginBottom: 16,
              }}>
                {error}
                <br />
                <span style={{ fontSize: 11, color: '#888' }}>
                  Make sure MT5 is open and the API is running: <code>cd backend && uvicorn api:app --reload --port 8000</code>
                </span>
              </div>
            )}

            {/* Loading skeleton */}
            {loading && !data && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[...Array(6)].map((_, i) => (
                  <div key={i} style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 8, height: 80, animation: 'pulse 1.5s infinite' }} />
                ))}
              </div>
            )}

            {/* Pair cards */}
            {filtered.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, color: '#444', marginBottom: 2 }}>
                  {filtered.length} pair{filtered.length !== 1 ? 's' : ''} shown — click a card to expand details
                </div>
                {filtered.map(pair => <PairCard key={pair.symbol} pair={pair} />)}
              </div>
            )}

            {filtered.length === 0 && !loading && data && (
              <div style={{ textAlign: 'center', color: '#444', padding: '40px 0', fontSize: 13 }}>
                No pairs match the current filters.
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.7; } }
        * { box-sizing: border-box; }
        input[type=number]::-webkit-inner-spin-button { opacity: 0.4; }
        input:focus { border-color: #444 !important; }
      `}</style>
    </div>
  );
}
