import { useState, useEffect, useMemo } from 'react';
import TargetPlanner from './TargetPlanner.jsx';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const DEFAULT_SETTINGS = {
  balance:       150000,
  useMt5Balance: true,
  dailyLossPct:  2,
  riskPct:       1,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem('riskScannerSettings');
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

function loadSelectedSymbol() {
  try {
    return localStorage.getItem('riskScannerSelectedSymbol') || null;
  } catch {
    return null;
  }
}

function persistSelectedSymbol(symbol) {
  try {
    if (symbol) localStorage.setItem('riskScannerSelectedSymbol', symbol);
    else localStorage.removeItem('riskScannerSelectedSymbol');
  } catch {
    // Ignore storage failures and continue with in-memory state.
  }
}

function getRequestedBalance(settings) {
  return settings.useMt5Balance ? null : Number(settings.balance);
}

function getMt5SnapshotBalance(accountSnapshot) {
  if (!accountSnapshot) return null;

  const balance = Number(accountSnapshot.balance || 0);
  if (balance > 0) return balance;

  const equity = Number(accountSnapshot.equity || 0);
  if (equity > 0) return equity;

  return null;
}

function getMt5SnapshotSource(accountSnapshot) {
  if (!accountSnapshot) return null;
  if (Number(accountSnapshot.balance || 0) > 0) return 'mt5_balance';
  if (Number(accountSnapshot.equity || 0) > 0) return 'mt5_equity';
  return null;
}

function formatBalanceSource(source) {
  if (source === 'manual_override') return 'Manual override';
  if (source === 'mt5_balance') return 'MT5 balance';
  if (source === 'mt5_equity') return 'MT5 equity fallback';
  if (source === 'mt5_unavailable') return 'MT5 unavailable';
  return 'Balance source';
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

function PairCard({ pair, selected, onSelect }) {
  const c = CLASS_COLOURS[pair.classification] || CLASS_COLOURS.RISKY;
  const badgeColour = CLASS_BADGE_COLOURS[pair.asset_class] || '#888';
  const dims = pair.dimensions;

  return (
    <div onClick={() => onSelect(pair.symbol)} style={{
      background: c.bg, border: `1px solid ${c.border}33`,
      borderLeft: `3px solid ${selected ? '#38bdf8' : c.border}`, borderRadius: 8,
      padding: '12px 14px', cursor: 'pointer', transition: 'border-color 0.2s, box-shadow 0.2s',
      boxShadow: selected ? '0 0 0 1px #38bdf855 inset' : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#f0f0f0' }}>{pair.symbol}</span>
          <Badge label={pair.class_label} colour={badgeColour} />
          <span style={{ fontSize: 11, color: '#666' }}>#{pair.class_rank}</span>
          {selected && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: '#38bdf8',
              border: '1px solid #38bdf855', background: '#38bdf822',
              borderRadius: 999, padding: '2px 8px',
            }}>
              Selected
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onSelect(pair.symbol);
            }}
            style={{
              background: selected ? '#38bdf822' : 'transparent',
              color: selected ? '#38bdf8' : '#666',
              border: `1px solid ${selected ? '#38bdf8' : '#333'}`,
              borderRadius: 6,
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {selected ? 'Used In Target' : 'Use In Target'}
          </button>
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

function SettingsTab({ settings, onSave, liveBalance, balanceSource, accountSnapshot }) {
  const [local, setLocal] = useState({ ...settings });

  const set = (key) => (val) => setLocal(prev => ({ ...prev, [key]: val }));

  const isDirty = JSON.stringify(local) !== JSON.stringify(settings);
  const mt5SnapshotBalance = getMt5SnapshotBalance(accountSnapshot);
  const mt5SnapshotSource = getMt5SnapshotSource(accountSnapshot);
  const previewBalance = local.useMt5Balance ? mt5SnapshotBalance : Number(local.balance);

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
              label="Balance Source"
              hint="Use the live MT5 account value by default, or force a manual override."
            >
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[
                  { active: local.useMt5Balance, label: 'Use MT5', value: true },
                  { active: !local.useMt5Balance, label: 'Manual', value: false },
                ].map(({ active, label, value }) => (
                  <button
                    key={label}
                    onClick={() => set('useMt5Balance')(value)}
                    style={{
                      background: active ? '#38bdf822' : 'transparent',
                      color: active ? '#38bdf8' : '#666',
                      border: `1px solid ${active ? '#38bdf8' : '#333'}`,
                      borderRadius: 6,
                      padding: '6px 12px',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 11, color: '#555' }}>
                {local.useMt5Balance
                  ? mt5SnapshotBalance !== null
                    ? `MT5 snapshot: ${formatBalanceSource(mt5SnapshotSource || balanceSource)} (${mt5SnapshotBalance.toLocaleString()})`
                    : 'No MT5 balance snapshot is available yet. Save & Rescan to retry the live account lookup.'
                  : 'Manual balance below will override MT5 for scanner and planner requests.'}
              </span>
            </SettingRow>

            {!local.useMt5Balance && (
              <SettingRow
                label="Manual Balance Override"
                hint="Only use this if you want to override the balance coming from MT5."
              >
                <SettingsInput prefix="NGN" value={local.balance} onChange={set('balance')} min={0} step={1000} />
              </SettingRow>
            )}
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
              {local.useMt5Balance ? (
                previewBalance !== null ? (
                  <span style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
                    Uses the live MT5 balance on the next scan. Preview: NGN {(previewBalance * Number(local.dailyLossPct) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
                    Waiting for a live MT5 balance snapshot before showing the preview amount.
                  </span>
                )
              ) : (
                <span style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>
                  = NGN {(Number(local.balance) * Number(local.dailyLossPct) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} at current balance
                </span>
              )}
            </SettingRow>

            <SettingRow
              label="Risk Per Trade"
              hint="% of balance you risk on each individual trade (used to calculate recommended lot size)."
            >
              <SettingsInput value={local.riskPct} onChange={set('riskPct')} suffix="%" min={0.1} max={10} step={0.1} />
              {local.useMt5Balance ? (
                previewBalance !== null ? (
                  <span style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
                    Uses the live MT5 balance on the next scan. Preview: NGN {(previewBalance * Number(local.riskPct) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} per trade
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
                    Waiting for a live MT5 balance snapshot before showing the per-trade preview.
                  </span>
                )
              ) : (
                <span style={{ fontSize: 11, color: '#38bdf8', marginTop: 2 }}>
                  = NGN {(Number(local.balance) * Number(local.riskPct) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} per trade
                </span>
              )}
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
  const [selectedSymbol, setSelectedSymbol] = useState(loadSelectedSymbol);
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
          balance:        getRequestedBalance(s),
          daily_loss_pct: Number(s.dailyLossPct) / 100,
          risk_pct:       Number(s.riskPct) / 100,
        }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      if (selectedSymbol && !(json.pairs || []).some(pair => pair.symbol === selectedSymbol)) {
        persistSelectedSymbol(null);
        setSelectedSymbol(null);
      }
      setData(json);
      setLast(new Date().toLocaleTimeString());
    } catch (e) {
      console.error("Scan fetch error:", e);
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

  const selectedPair = useMemo(
    () => data?.pairs?.find(pair => pair.symbol === selectedSymbol) || null,
    [data, selectedSymbol]
  );

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

  const handleSelectPair = (symbol) => {
    persistSelectedSymbol(symbol);
    setSelectedSymbol(symbol);
  };

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
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#555' }}>Capital preservation - Gate-and-Rank scoring</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <button onClick={() => fetchData()} disabled={loading} style={{
              background: '#1e1e1e', color: loading ? '#555' : '#e0e0e0',
              border: '1px solid #333', borderRadius: 6,
              padding: '6px 16px', cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 12, fontWeight: 600,
            }}>
              {loading ? 'Scanning...' : 'Refresh'}
            </button>
            {lastRefresh && <div style={{ fontSize: 11, color: '#444', marginTop: 4 }}>Last scan: {lastRefresh}</div>}
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1e1e1e', marginBottom: 20, gap: 4 }}>
          <button style={TAB_STYLE(tab === 'scanner')} onClick={() => setTab('scanner')}>Scanner</button>
          <button style={TAB_STYLE(tab === 'target')} onClick={() => setTab('target')}>Target</button>
          <button style={TAB_STYLE(tab === 'settings')} onClick={() => setTab('settings')}>Settings</button>
        </div>

        {/* Settings tab */}
        {tab === 'settings' && (
          <SettingsTab
            settings={settings}
            onSave={handleSaveSettings}
            liveBalance={data?.balance_ngn}
            balanceSource={data?.balance_source}
            accountSnapshot={data?.account_snapshot}
          />
        )}

        {tab === 'target' && (
          <TargetPlanner
            settings={settings}
            liveBalance={data?.balance_ngn}
            balanceSource={data?.balance_source}
            accountSnapshot={data?.account_snapshot}
            selectedSymbol={selectedSymbol}
            selectedPair={selectedPair}
          />
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
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#f0f0f0' }}>NGN {data.balance_ngn?.toLocaleString()}</div>
                  {data.balance_source && (
                    <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{formatBalanceSource(data.balance_source)}</div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Target Pair</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: selectedPair ? '#38bdf8' : '#666' }}>
                    {selectedPair?.symbol || 'Not selected'}
                  </div>
                  <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>
                    {selectedPair ? `${selectedPair.classification} · ${selectedPair.score}/100` : 'Choose from scanner cards'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Daily Limit</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#f59e0b' }}>NGN {data.daily_limit_ngn?.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Risk / Trade</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#38bdf8' }}>NGN {data.risk_per_trade?.toLocaleString()}</div>
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
                <span style={{ color: '#444' }}>-</span>
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
                  {filtered.length} pair{filtered.length !== 1 ? 's' : ''} shown - each card stays expanded, and clicking a card selects the pair used in the Target tab and KPI flow
                </div>
                {filtered.map(pair => (
                  <PairCard
                    key={pair.symbol}
                    pair={pair}
                    selected={pair.symbol === selectedSymbol}
                    onSelect={handleSelectPair}
                  />
                ))}
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
