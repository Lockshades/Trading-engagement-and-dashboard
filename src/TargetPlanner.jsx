import { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
  Bar,
  LineChart,
  Line,
  ReferenceLine,
  Area,
  ComposedChart,
} from 'recharts';

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

const HISTORY_OPTIONS = [
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
  { value: '180', label: '180d' },
  { value: '365', label: '365d' },
  { value: 'all', label: 'All' },
];

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStd(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function computeStats(values) {
  if (!values.length) return null;
  const mean = average(values);
  const std = sampleStd(values);
  const wins = values.filter((value) => value > 0).length;
  const losses = values.filter((value) => value <= 0).length;
  const lossRate = values.length > 0 ? losses / values.length : 0;

  return {
    n: values.length,
    mean,
    std,
    cv: mean !== 0 ? Math.abs(std / mean) * 100 : 999,
    winRate: values.length > 0 ? (wins / values.length) * 100 : 0,
    lossRate,
  };
}

function buildMarginalDays(historyDeals, threshold) {
  if (!Array.isArray(historyDeals) || historyDeals.length === 0) return [];

  const byDay = new Map();
  [...historyDeals]
    .sort((left, right) => Number(left.time || 0) - Number(right.time || 0))
    .forEach((deal) => {
      const stamp = Number(deal.time || 0) * 1000;
      const dayKey = new Date(stamp).toISOString().slice(0, 10);
      if (!byDay.has(dayKey)) byDay.set(dayKey, []);
      byDay.get(dayKey).push(deal);
    });

  return [...byDay.entries()].map(([date, deals], dayIndex) => {
    let cumPnL = 0;
    let thresholdHit = false;
    let aboveIndex = 0;

    const trades = deals.map((deal, tradeIndex) => {
      const wasAboveThreshold = thresholdHit;
      const pnl = Number(deal.profit || 0);
      const lockedProfitAtEntry = wasAboveThreshold ? Math.max(cumPnL, 0) : 0;
      cumPnL += pnl;
      if (!thresholdHit && cumPnL >= threshold) thresholdHit = true;
      if (wasAboveThreshold) aboveIndex += 1;

      return {
        tradeIndex: tradeIndex + 1,
        pnl,
        cumPnL,
        symbol: deal.symbol,
        volume: Number(deal.volume || 0),
        aboveThreshold: wasAboveThreshold,
        aboveIndex: wasAboveThreshold ? aboveIndex : null,
        lockedProfitAtEntry,
      };
    });

    return {
      day: dayIndex + 1,
      date,
      trades,
      finalPnL: cumPnL,
      thresholdHit,
    };
  });
}

function computeMarginalCurves(days) {
  const belowPools = new Map();
  const abovePools = new Map();
  const lockedPools = new Map();

  days.forEach((day) => {
    day.trades.forEach((trade) => {
      if (!trade.aboveThreshold) {
        const bucket = belowPools.get(trade.tradeIndex) || [];
        bucket.push(trade.pnl);
        belowPools.set(trade.tradeIndex, bucket);
      }

      if (trade.aboveThreshold && trade.aboveIndex !== null) {
        const aboveBucket = abovePools.get(trade.aboveIndex) || [];
        aboveBucket.push(trade.pnl);
        abovePools.set(trade.aboveIndex, aboveBucket);

        const lockBucket = lockedPools.get(trade.aboveIndex) || [];
        lockBucket.push(trade.lockedProfitAtEntry);
        lockedPools.set(trade.aboveIndex, lockBucket);
      }
    });
  });

  const belowCurve = [...belowPools.entries()]
    .map(([position, values]) => {
      const stats = computeStats(values);
      return stats ? { position: `T${position}`, posNum: position, zone: 'below', ...stats } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.posNum - right.posNum);

  const aboveCurve = [...abovePools.entries()]
    .map(([position, values]) => {
      const stats = computeStats(values);
      if (!stats) return null;
      const lockedValues = lockedPools.get(position) || [];
      return {
        position: `+${position}`,
        posNum: position,
        zone: 'above',
        avgLockedProfit: average(lockedValues),
        ...stats,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.posNum - right.posNum);

  return { belowCurve, aboveCurve };
}

function buildEconomicsData(belowCurve, aboveCurve) {
  let totalCost = 0;
  return [...belowCurve, ...aboveCurve].map((item, index) => {
    const marginalCost = item.zone === 'above'
      ? Math.round((item.avgLockedProfit || 0) * (item.lossRate || 0))
      : 0;
    totalCost += marginalCost;
    return {
      position: item.position,
      zone: item.zone,
      mean: Math.round(item.mean),
      marginalCost,
      totalCost,
      averageCost: index >= 0 ? Math.round(totalCost / (index + 1)) : 0,
      samples: item.n,
      cv: Math.round(item.cv),
    };
  });
}

function buildSuggestions(aboveCurve) {
  return aboveCurve.map((item) => {
    const eligible = item.mean > 0 && item.cv < 35 && item.n >= 20;
    return {
      position: item.position,
      mean: Math.round(item.mean),
      cv: Math.round(item.cv),
      samples: item.n,
      avgLockedProfit: Math.round(item.avgLockedProfit || 0),
      eligible,
    };
  });
}

function SimpleTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div style={{ background: '#111', border: '1px solid #333', borderRadius: 8, padding: '10px 12px', fontSize: 11 }}>
      <div style={{ color: '#aaa', marginBottom: 4 }}>{label}</div>
      {payload.map((entry) => (
        <div key={entry.dataKey} style={{ color: entry.color || '#e0e0e0' }}>
          {entry.name}: {Number(entry.value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
        </div>
      ))}
    </div>
  );
}

function formatMoney(value) {
  return `NGN ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
}

function formatBalanceSource(source) {
  if (source === 'manual_override') return 'Manual override';
  if (source === 'mt5_balance') return 'MT5 balance';
  if (source === 'mt5_equity') return 'MT5 equity fallback';
  if (source === 'mt5_unavailable') return 'MT5 unavailable';
  return 'Balance source';
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

export default function TargetPlanner({ settings, liveBalance, balanceSource, accountSnapshot, selectedSymbol, selectedPair }) {
  const [subTab, setSubTab] = useState('path');
  const [targetInput, setTargetInput] = useState('');
  const [historyRange, setHistoryRange] = useState('90');
  const [analysisThresholdPct, setAnalysisThresholdPct] = useState(1.0);
  const [selectedAnalysisDay, setSelectedAnalysisDay] = useState(null);
  const [planData, setPlanData] = useState(null);
  const [kpiData, setKpiData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [error, setError] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [showOverrides, setShowOverrides] = useState(false);

  const fallbackBalance = Number(settings?.balance || 150000);
  const requestedBalance = settings?.useMt5Balance ? null : fallbackBalance;
  const mt5SnapshotBalance = getMt5SnapshotBalance(accountSnapshot);
  const mt5SnapshotSource = getMt5SnapshotSource(accountSnapshot);
  const balance = Number(
    settings?.useMt5Balance
      ? (mt5SnapshotBalance !== null ? mt5SnapshotBalance : 0)
      : fallbackBalance
  );
  const dailyLossPct = Number(settings?.dailyLossPct || 2) / 100;
  const riskPct = Number(settings?.riskPct || 1) / 100;
  const parsedTarget = Number(targetInput);
  const useAllHistory = historyRange === 'all';
  const historyDays = useAllHistory ? null : Number(historyRange);
  const hasSelectedSymbol = Boolean(selectedSymbol);
  const hasValidTarget = Number.isFinite(parsedTarget) && parsedTarget > balance;
  const canGeneratePlan = hasSelectedSymbol && hasValidTarget;
  const planMatchesInput = planData
    && Number(planData.target_ngn) === parsedTarget
    && planData.planning_symbol === selectedSymbol
    && ((planData.history_window_days ?? 'all') === (historyDays ?? 'all'));
  const activePlan = planMatchesInput ? planData : null;
  const totalTradingDays = activePlan?.history_stats?.total_trading_days || 0;
  const noHistory = Boolean(activePlan?.history_stats?.no_history);
  const veryThinHistory = totalTradingDays > 0 && totalTradingDays < 3;
  const lowData = totalTradingDays >= 3 && Boolean(activePlan?.history_stats?.low_data_warning);
  const analysisCapital = activePlan?.balance_ngn || balance;
  const analysisThreshold = analysisCapital * (analysisThresholdPct / 100);
  const marginalDays = useMemo(
    () => buildMarginalDays(activePlan?.history_deals || [], analysisThreshold),
    [activePlan?.history_deals, analysisThreshold]
  );
  const { belowCurve, aboveCurve } = useMemo(
    () => computeMarginalCurves(marginalDays),
    [marginalDays]
  );
  const economicsData = useMemo(
    () => buildEconomicsData(belowCurve, aboveCurve),
    [belowCurve, aboveCurve]
  );
  const suggestionData = useMemo(
    () => buildSuggestions(aboveCurve),
    [aboveCurve]
  );
  const thresholdHitDays = marginalDays.filter((day) => day.thresholdHit).length;
  const totalTradesSampled = Array.isArray(activePlan?.history_deals) ? activePlan.history_deals.length : 0;
  const analysisDayIndex = selectedAnalysisDay && selectedAnalysisDay <= marginalDays.length
    ? selectedAnalysisDay
    : Math.max(marginalDays.length, 1);
  const analysisDay = marginalDays[analysisDayIndex - 1] || null;
  const todaySeries = useMemo(() => {
    if (!analysisDay) return [];
    let cumPnL = 0;
    return analysisDay.trades.map((trade) => {
      cumPnL += trade.pnl;
      return {
        label: trade.aboveThreshold ? `+${trade.aboveIndex}` : `T${trade.tradeIndex}`,
        pnl: trade.pnl,
        cumPnL,
        symbol: trade.symbol,
      };
    });
  }, [analysisDay]);
  const todayVsAverageData = useMemo(() => {
    if (!analysisDay) return [];

    const merged = [
      ...belowCurve.map((item) => ({ ...item, zone: 'below' })),
      ...aboveCurve.map((item) => ({ ...item, zone: 'above' })),
    ];

    return merged.map((item) => {
      const todayTrade = analysisDay.trades.find((trade) => (
        item.zone === 'below'
          ? !trade.aboveThreshold && trade.tradeIndex === item.posNum
          : trade.aboveThreshold && trade.aboveIndex === item.posNum
      ));

      return {
        position: item.position,
        mean: Math.round(item.mean),
        todayPnL: todayTrade ? Math.round(todayTrade.pnl) : null,
      };
    });
  }, [analysisDay, belowCurve, aboveCurve]);

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
    if (!hasSelectedSymbol) {
      setError('Choose a pair from the Scanner tab first.');
      return;
    }

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
          balance: requestedBalance,
          daily_loss_pct: dailyLossPct,
          risk_pct: riskPct,
          planning_symbol: selectedSymbol,
          history_days: historyDays,
          use_all_history: useAllHistory,
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
    if (!hasSelectedSymbol) {
      setError('Choose a pair from the Scanner tab before loading KPI data.');
      return;
    }

    if (!hasValidTarget) {
      setError('Enter a target above your current balance before loading KPI data.');
      return;
    }

    setKpiLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        daily_loss_pct: String(dailyLossPct),
        risk_pct: String(riskPct),
        target_ngn: String(parsedTarget),
        planning_symbol: selectedSymbol,
      });
      if (historyDays !== null) {
        params.set('history_days', String(historyDays));
      }
      if (useAllHistory) {
        params.set('use_all_history', 'true');
      }
      if (requestedBalance !== null) {
        params.set('balance', String(requestedBalance));
      }

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
    if (canGeneratePlan) {
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
        <button style={subTabStyle(subTab === 'analysis')} onClick={() => setSubTab('analysis')}>Analysis</button>
        <button style={subTabStyle(subTab === 'kpi')} onClick={openKpi}>Daily KPI</button>
      </div>

      {subTab === 'path' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 999,
              background: selectedPair ? '#38bdf822' : '#171717',
              border: `1px solid ${selectedPair ? '#38bdf855' : '#333'}`,
              marginRight: 4,
            }}>
              <span style={{ fontSize: 11, color: '#666' }}>Pair</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: selectedPair ? '#38bdf8' : '#999' }}>
                {selectedPair?.symbol || 'Choose in Scanner'}
              </span>
              {selectedPair && (
                <span style={{ fontSize: 11, color: '#999' }}>
                  {selectedPair.classification} · {selectedPair.score}/100
                </span>
              )}
            </div>
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
              disabled={loading || !canGeneratePlan}
              style={{
                background: canGeneratePlan ? '#22c55e22' : '#1a1a1a',
                color: canGeneratePlan ? '#22c55e' : '#555',
                border: `1px solid ${canGeneratePlan ? '#22c55e' : '#333'}`,
                borderRadius: 6,
                padding: '7px 20px',
                cursor: loading || !canGeneratePlan ? 'not-allowed' : 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {loading ? 'Planning...' : 'Generate Plan'}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 4 }}>
              <span style={{ fontSize: 12, color: '#666' }}>History</span>
              <select
                value={historyRange}
                onChange={(event) => {
                  setHistoryRange(event.target.value);
                  setPlanData(null);
                  setKpiData(null);
                  setError(null);
                }}
                style={{
                  background: '#111',
                  border: '1px solid #333',
                  color: '#e0e0e0',
                  borderRadius: 6,
                  padding: '7px 10px',
                  fontSize: 13,
                }}
              >
                {HISTORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!hasSelectedSymbol && (
            <div style={{ color: '#f59e0b', fontSize: 12, marginBottom: 14 }}>
              Choose one scanned pair in the Scanner tab first. That selection is used throughout the Target workflow.
            </div>
          )}

          {hasSelectedSymbol && !hasValidTarget && targetInput && (
            <div style={{ color: '#f59e0b', fontSize: 12, marginBottom: 14 }}>
              Enter a target greater than {formatMoney(balance)}.
            </div>
          )}

          {settings?.useMt5Balance && (
            <div style={{ color: '#555', fontSize: 12, marginBottom: 14 }}>
              {mt5SnapshotBalance !== null
                ? `Using ${formatBalanceSource(mt5SnapshotSource || balanceSource)} at ${formatMoney(mt5SnapshotBalance)} for current balance checks.`
                : 'Waiting for a live MT5 balance snapshot. Generate a fresh scan before relying on MT5-based target validation.'}
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

          {activePlan && totalTradingDays < 20 && !useAllHistory && (
            <div style={{ background: '#0f1720', border: '1px solid #38bdf844', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#38bdf8' }}>
              Recent history is thin. Try 180d, 365d, or All to include more MT5 history in the Target plan.
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
                {activePlan.balance_source && (
                  <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{formatBalanceSource(activePlan.balance_source)}</div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Target</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#22c55e' }}>{formatMoney(activePlan.target_ngn)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>History Window</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#f0f0f0' }}>{activePlan.history_window_label}</div>
                <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>
                  {activePlan.history_deals_count} of {activePlan.history_total_deals_count} deal{activePlan.history_total_deals_count === 1 ? '' : 's'} matched this pair
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>History Days</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#38bdf8' }}>{totalTradingDays}</div>
                <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>Trading days found</div>
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

      {subTab === 'analysis' && (
        <div>
          {!activePlan && (
            <div style={{ color: '#444', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
              Generate a Target plan first so the analysis tab can inspect the same history window and sampled deals.
            </div>
          )}

          {activePlan && (
            <>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                {[
                  ['Window', activePlan.history_window_label, `${totalTradesSampled} deals`],
                  ['Trading Days', totalTradingDays, 'days found'],
                  ['Threshold Hit Days', thresholdHitDays, `${marginalDays.length} days sampled`],
                  ['Analysis Threshold', formatMoney(analysisThreshold), `${analysisThresholdPct.toFixed(1)}% of current capital`],
                ].map(([label, value, sub]) => (
                  <div
                    key={label}
                    style={{
                      flex: '1 1 180px',
                      background: '#111',
                      border: '1px solid #1e1e1e',
                      borderRadius: 8,
                      padding: '12px 14px',
                    }}
                  >
                    <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#f0f0f0', marginTop: 6 }}>{value}</div>
                    <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>{sub}</div>
                  </div>
                ))}
              </div>

              {economicsData.length === 0 && (
                <div style={{ color: '#444', fontSize: 13, textAlign: 'center', paddingTop: 30 }}>
                  Not enough trade-by-trade history in the selected window to build marginal analysis yet.
                </div>
              )}

              {economicsData.length > 0 && (
                <>
                  <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 8, padding: '14px', marginBottom: 16 }}>
                    <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 11, color: '#666' }}>Threshold</span>
                        <input
                          type="range"
                          min={0.5}
                          max={5}
                          step={0.1}
                          value={analysisThresholdPct}
                          onChange={(event) => setAnalysisThresholdPct(Number(event.target.value))}
                          style={{ accentColor: '#38bdf8', width: 180 }}
                        />
                        <span style={{ fontSize: 12, color: '#38bdf8', minWidth: 120 }}>
                          {analysisThresholdPct.toFixed(1)}% = {formatMoney(analysisThreshold)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 11, color: '#666' }}>Day</span>
                        <input
                          type="range"
                          min={1}
                          max={Math.max(marginalDays.length, 1)}
                          value={analysisDayIndex}
                          onChange={(event) => setSelectedAnalysisDay(Number(event.target.value))}
                          style={{ accentColor: '#22c55e', width: 180 }}
                        />
                        <span style={{ fontSize: 12, color: '#e0e0e0' }}>
                          {analysisDay ? `${analysisDay.date} (${analysisDayIndex}/${marginalDays.length})` : 'No day selected'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {analysisDay && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, marginBottom: 16 }}>
                      <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 8, padding: '14px' }}>
                        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 10 }}>Selected Day Cumulative PnL</div>
                        <div style={{ height: 260 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={todaySeries}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
                              <XAxis dataKey="label" tick={{ fill: '#666', fontSize: 11 }} />
                              <YAxis tick={{ fill: '#666', fontSize: 11 }} />
                              <Tooltip content={<SimpleTooltip />} />
                              <ReferenceLine y={0} stroke="#555" />
                              <ReferenceLine y={analysisThreshold} stroke="#f59e0b" strokeDasharray="6 3" />
                              <Area type="stepAfter" dataKey="cumPnL" name="Cum PnL" stroke="#38bdf8" fill="#38bdf822" strokeWidth={2} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 8, padding: '14px' }}>
                        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 10 }}>Selected Day vs Historical Mean by Position</div>
                        <div style={{ height: 260 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={todayVsAverageData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
                              <XAxis dataKey="position" tick={{ fill: '#666', fontSize: 11 }} />
                              <YAxis tick={{ fill: '#666', fontSize: 11 }} />
                              <Tooltip content={<SimpleTooltip />} />
                              <ReferenceLine y={0} stroke="#555" />
                              <Bar dataKey="mean" name="Mean" fill="#38bdf8" />
                              <Bar dataKey="todayPnL" name="Selected Day" fill="#f59e0b" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
                    <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 8, padding: '14px' }}>
                      <div style={{ fontSize: 12, color: '#aaa', marginBottom: 10 }}>Marginal Mean by Position</div>
                      <div style={{ height: 280 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={economicsData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
                            <XAxis dataKey="position" tick={{ fill: '#666', fontSize: 11 }} />
                            <YAxis tick={{ fill: '#666', fontSize: 11 }} />
                            <Tooltip content={<SimpleTooltip />} />
                            <ReferenceLine y={0} stroke="#555" />
                            <Bar dataKey="mean" name="Mean PnL" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 8, padding: '14px' }}>
                      <div style={{ fontSize: 12, color: '#aaa', marginBottom: 10 }}>Opportunity Cost After Threshold</div>
                      <div style={{ height: 280 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={economicsData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
                            <XAxis dataKey="position" tick={{ fill: '#666', fontSize: 11 }} />
                            <YAxis tick={{ fill: '#666', fontSize: 11 }} />
                            <Tooltip content={<SimpleTooltip />} />
                            <ReferenceLine y={0} stroke="#555" />
                            <Line type="monotone" dataKey="marginalCost" name="Marginal Cost" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                            <Line type="monotone" dataKey="averageCost" name="Average Cost" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 8, padding: '14px', marginTop: 16 }}>
                    <div style={{ fontSize: 12, color: '#aaa', marginBottom: 10 }}>Position Suggestions</div>
                    {suggestionData.length === 0 && (
                      <div style={{ color: '#555', fontSize: 12 }}>No above-threshold positions were observed in this history window.</div>
                    )}
                    {suggestionData.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {suggestionData.map((item) => (
                          <div
                            key={item.position}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 12,
                              flexWrap: 'wrap',
                              padding: '10px 12px',
                              border: '1px solid #1e1e1e',
                              borderRadius: 8,
                              background: item.eligible ? '#0d2e1a' : '#171717',
                            }}
                          >
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                              <div style={{ fontWeight: 700, color: '#f0f0f0' }}>{item.position}</div>
                              <div style={{ fontSize: 12, color: '#999' }}>Mean {formatMoney(item.mean)}</div>
                              <div style={{ fontSize: 12, color: '#999' }}>CV {item.cv}%</div>
                              <div style={{ fontSize: 12, color: '#999' }}>{item.samples} samples</div>
                              <div style={{ fontSize: 12, color: '#999' }}>Locked profit avg {formatMoney(item.avgLockedProfit)}</div>
                            </div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: item.eligible ? '#22c55e' : '#f59e0b' }}>
                              {item.eligible ? 'Stable positive edge' : 'Not stable enough yet'}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
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
              disabled={kpiLoading || !canGeneratePlan}
              style={{
                background: '#1e1e1e',
                color: canGeneratePlan ? '#e0e0e0' : '#555',
                border: '1px solid #333',
                borderRadius: 6,
                padding: '5px 14px',
                cursor: kpiLoading || !canGeneratePlan ? 'not-allowed' : 'pointer',
                fontSize: 11,
              }}
            >
              {kpiLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{error}</div>}

          {!hasSelectedSymbol && (
            <div style={{ color: '#444', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
              Select a pair in the Scanner tab before loading KPI data.
            </div>
          )}

          {hasSelectedSymbol && !hasValidTarget && (
            <div style={{ color: '#444', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
              Enter a target above your current balance in the Path tab before loading KPI data.
            </div>
          )}

          {canGeneratePlan && !kpiLoading && !kpiData && (
            <div style={{ color: '#444', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
              Open the Path tab to generate a plan, or refresh here to load today&apos;s KPI snapshot for the current target.
            </div>
          )}

          {canGeneratePlan && !kpiLoading && kpiData && !kpiData.current_milestone && (
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
                    <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>History Window</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#f0f0f0' }}>{kpiData.history_window_label}</div>
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
