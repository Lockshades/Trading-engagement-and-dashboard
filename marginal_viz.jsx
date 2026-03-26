import { useState, useMemo, useCallback } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, ScatterChart, Scatter,
  ComposedChart, ErrorBar
} from "recharts";

// ─── REAL MT5 DATA ───────────────────────────────────────────────────────────
// Exness account 130965031 (NGN). 37 closed positions, Jan 14 – Mar 7, 2026.
// Primarily BTCUSDm. Commission & swap = ₦0 on all trades.

const MT5_RAW_TRADES = [
  { date:"2026-01-14", symbol:"BTCUSDm", type:"sell", volume:0.02, profit:14992.12 },
  { date:"2026-01-14", symbol:"BTCUSDm", type:"sell", volume:0.01, profit:6242.25 },
  { date:"2026-01-15", symbol:"BTCUSDm", type:"sell", volume:0.01, profit:131.79 },
  { date:"2026-01-15", symbol:"BTCUSDm", type:"sell", volume:0.01, profit:3701.37 },
  { date:"2026-01-15", symbol:"BTCUSDm", type:"buy",  volume:0.01, profit:1492.51 },
  { date:"2026-01-15", symbol:"ETHUSDm", type:"sell", volume:0.10, profit:-3521.75 },
  { date:"2026-01-15", symbol:"BTCUSDm", type:"sell", volume:0.01, profit:-5117.54 },
  { date:"2026-01-15", symbol:"BTCUSDm", type:"sell", volume:0.01, profit:18625.29 },
  { date:"2026-01-15", symbol:"BTCUSDm", type:"buy",  volume:0.01, profit:-5067.00 },
  { date:"2026-01-15", symbol:"BTCUSDm", type:"buy",  volume:0.01, profit:2365.90 },
  { date:"2026-01-16", symbol:"BTCUSDm", type:"sell", volume:0.01, profit:-504.01 },
  { date:"2026-01-16", symbol:"BTCUSDm", type:"buy",  volume:0.01, profit:102.21 },
  { date:"2026-01-16", symbol:"BTCUSDm", type:"sell", volume:0.03, profit:-29.65 },
  { date:"2026-01-17", symbol:"BTCUSDm", type:"buy",  volume:0.01, profit:-889.83 },
  { date:"2026-02-07", symbol:"BTCUSDm", type:"sell", volume:0.02, profit:11541.60 },
  { date:"2026-02-07", symbol:"BTCUSDm", type:"sell", volume:0.02, profit:970.12 },
  { date:"2026-02-07", symbol:"BTCUSDm", type:"buy",  volume:0.01, profit:-723.68 },
  { date:"2026-02-07", symbol:"BTCUSDm", type:"sell", volume:0.01, profit:1412.38 },
  { date:"2026-02-07", symbol:"BTCUSDm", type:"sell", volume:0.02, profit:-2040.77 },
  { date:"2026-02-07", symbol:"BTCUSDm", type:"sell", volume:0.02, profit:14.27 },
  { date:"2026-02-07", symbol:"BTCUSDm", type:"sell", volume:0.01, profit:4008.89 },
  { date:"2026-02-07", symbol:"BTCUSDm", type:"sell", volume:0.02, profit:41929.26 },
  { date:"2026-02-09", symbol:"BTCUSDm", type:"buy",  volume:0.01, profit:85.45 },
  { date:"2026-02-09", symbol:"BTCUSDm", type:"sell", volume:0.01, profit:2933.97 },
  { date:"2026-02-09", symbol:"BTCUSDm", type:"sell", volume:0.01, profit:-1963.92 },
  { date:"2026-02-09", symbol:"BTCUSDm", type:"buy",  volume:0.02, profit:2805.90 },
  { date:"2026-02-10", symbol:"BTCUSDm", type:"buy",  volume:0.01, profit:13472.16 },
  { date:"2026-02-10", symbol:"BTCUSDm", type:"buy",  volume:0.01, profit:28.48 },
  { date:"2026-02-10", symbol:"BTCUSDm", type:"buy",  volume:0.01, profit:2691.19 },
  { date:"2026-02-10", symbol:"BTCUSDm", type:"buy",  volume:0.02, profit:-274.11 },
  { date:"2026-02-12", symbol:"BTCUSDm", type:"sell", volume:0.01, profit:-3722.24 },
  { date:"2026-02-12", symbol:"BTCUSDm", type:"sell", volume:0.01, profit:-1588.87 },
  { date:"2026-02-12", symbol:"BTCUSDm", type:"buy",  volume:0.02, profit:1454.95 },
  { date:"2026-02-12", symbol:"BTCUSDm", type:"buy",  volume:0.01, profit:5119.59 },
  { date:"2026-02-12", symbol:"BTCUSDm", type:"sell", volume:0.01, profit:-2139.81 },
  { date:"2026-03-06", symbol:"BTCUSDm", type:"buy",  volume:0.01, profit:-5084.94 },
  { date:"2026-03-07", symbol:"BTCUSDm", type:"sell", volume:0.01, profit:988.83 },
];

function buildDaysFromRawTrades(rawTrades, threshold) {
  const byDate = {};
  rawTrades.forEach(t => {
    if (!byDate[t.date]) byDate[t.date] = [];
    byDate[t.date].push(t);
  });

  const days = [];
  Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b)).forEach(([date, dateTrades]) => {
    const trades = [];
    let cumPnL = 0, thresholdHit = false, aboveIndex = 0;

    dateTrades.forEach((t, idx) => {
      const wasAboveThreshold = thresholdHit;
      cumPnL += t.profit;
      if (!thresholdHit && cumPnL >= threshold) thresholdHit = true;
      if (wasAboveThreshold) aboveIndex++;

      trades.push({
        tradeIndex: idx + 1,
        pnl: Math.round(t.profit * 100) / 100,
        cumPnL: Math.round(cumPnL * 100) / 100,
        aboveThreshold: wasAboveThreshold,
        aboveIndex: wasAboveThreshold ? aboveIndex : null,
        lockedProfitAtEntry: wasAboveThreshold ? Math.max(Math.round((cumPnL - t.profit) * 100) / 100, 0) : 0,
        symbol: t.symbol,
        type: t.type,
        volume: t.volume,
      });
    });

    days.push({ day: days.length + 1, date, trades, finalPnL: Math.round(cumPnL * 100) / 100, thresholdHit });
  });
  return days;
}

// ─── SYNTHETIC DATA ENGINE ────────────────────────────────────────────────────

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function generateSyntheticDays(numDays, threshold) {
  const rng = seededRandom(42);
  const days = [];

  for (let d = 0; d < numDays; d++) {
    const tradesCount = 2 + Math.floor(rng() * 6);
    const trades = [];
    let cumPnL = 0, thresholdHit = false, aboveIndex = 0;
    const dayBias = (rng() - 0.42) * 800;

    for (let t = 0; t < tradesCount; t++) {
      const basePnL = dayBias / tradesCount + (rng() - 0.5) * 1200;
      const fatigueFactor = thresholdHit ? 0.75 - (aboveIndex * 0.12) : 1.0;
      const pnl = Math.round(basePnL * fatigueFactor);
      const wasAboveThreshold = thresholdHit;
      cumPnL += pnl;
      if (!thresholdHit && cumPnL >= threshold) thresholdHit = true;
      if (wasAboveThreshold) aboveIndex++;

      trades.push({
        tradeIndex: t + 1, pnl, cumPnL,
        aboveThreshold: wasAboveThreshold,
        aboveIndex: wasAboveThreshold ? aboveIndex : null,
        lockedProfitAtEntry: wasAboveThreshold ? Math.max(cumPnL - pnl, 0) : 0,
      });
    }
    days.push({ day: d + 1, trades, finalPnL: cumPnL, thresholdHit });
  }
  return days;
}

// ─── ANALYTICS ENGINE ─────────────────────────────────────────────────────────

const stats = (arr) => {
  if (!arr || arr.length === 0) return null;
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(n - 1, 1);
  const std = Math.sqrt(variance);
  const cv = mean !== 0 ? Math.abs(std / mean) * 100 : 999;
  const sorted = [...arr].sort((a, b) => a - b);
  const wins = arr.filter(v => v > 0).length;
  const losses = arr.filter(v => v <= 0).length;
  const lossRate = n > 0 ? losses / n : 0.5;
  return { mean: Math.round(mean), std: Math.round(std), cv: Math.round(cv),
           n, winRate: Math.round(wins / n * 100), lossRate, min: sorted[0], max: sorted[n-1] };
};

function computeMarginalCurves(days) {
  const belowPools = {}, abovePools = {};
  days.forEach(day => {
    day.trades.forEach(t => {
      if (!t.aboveThreshold) {
        if (!belowPools[t.tradeIndex]) belowPools[t.tradeIndex] = [];
        belowPools[t.tradeIndex].push(t.pnl);
      }
      if (t.aboveThreshold && t.aboveIndex !== null) {
        if (!abovePools[t.aboveIndex]) abovePools[t.aboveIndex] = [];
        abovePools[t.aboveIndex].push(t.pnl);
      }
    });
  });

  // Collect locked profit pools for opportunity cost
  const lockedProfitPools = {};
  days.forEach(day => {
    day.trades.forEach(t => {
      if (t.aboveThreshold && t.aboveIndex !== null) {
        if (!lockedProfitPools[t.aboveIndex]) lockedProfitPools[t.aboveIndex] = [];
        lockedProfitPools[t.aboveIndex].push(t.lockedProfitAtEntry);
      }
    });
  });

  const belowCurve = Object.entries(belowPools).map(([idx, vals]) => ({
    position: `T${idx}`, posNum: parseInt(idx), type: "below", ...stats(vals)
  })).sort((a, b) => a.posNum - b.posNum);

  const aboveCurve = Object.entries(abovePools).map(([idx, vals]) => {
    const s = stats(vals);
    const lockedProfits = lockedProfitPools[idx] || [];
    const avgLockedProfit = lockedProfits.length > 0
      ? lockedProfits.reduce((a, b) => a + b, 0) / lockedProfits.length : 0;
    return {
      position: `+${idx}`, posNum: parseInt(idx), type: "above",
      ...s, avgLockedProfit: Math.round(avgLockedProfit),
    };
  }).sort((a, b) => a.posNum - b.posNum);

  return { belowCurve, aboveCurve };
}

function computeEconomicsCurves(belowCurve, aboveCurve) {
  // Build unified sequence: below positions then above positions
  const all = [
    ...belowCurve.map(p => ({
      position: p.position, zone: "below", posNum: p.posNum,
      mr: p.mean,  // MR = mean gross P&L at this position
      mc: 0,       // MC below threshold = 0 (no opportunity cost)
      n: p.n, winRate: p.winRate, lossRate: p.lossRate,
    })),
    ...aboveCurve.map(p => ({
      position: p.position, zone: "above", posNum: p.posNum,
      mr: p.mean,
      // MC above threshold = opportunity cost = locked profit × loss rate
      mc: Math.round((p.avgLockedProfit || 0) * (p.lossRate || 0.5)),
      n: p.n, winRate: p.winRate, lossRate: p.lossRate,
      avgLockedProfit: p.avgLockedProfit,
    })),
  ];

  // Compute TC (cumulative MC) and AC (TC / position index)
  let cumMC = 0;
  return all.map((p, i) => {
    cumMC += p.mc;
    return {
      ...p,
      tc: cumMC,
      ac: i > 0 ? Math.round(cumMC / (i + 1)) : 0,
      surplus: p.mr - p.mc, // economic surplus per trade
    };
  });
}

function computeCVOverTime(days) {
  const maxPos = 3;
  const result = {};
  for (let i = 1; i <= maxPos; i++) result[i] = [];

  for (let pos = 1; pos <= maxPos; pos++) {
    const pool = [];
    days.forEach((day, di) => {
      const trade = day.trades.find(t => t.aboveThreshold && t.aboveIndex === pos);
      if (trade) pool.push(trade.pnl);
      if (pool.length >= 3) {
        const mean = pool.reduce((a, b) => a + b, 0) / pool.length;
        const std = Math.sqrt(pool.reduce((a, b) => a + (b - mean) ** 2, 0) / pool.length);
        const cv = mean !== 0 ? Math.abs(std / mean) * 100 : 200;
        result[pos].push({ day: di + 1, cv: Math.round(cv), n: pool.length, mean: Math.round(mean) });
      }
    });
  }
  return result;
}

function computeSuggestion(aboveCurve) {
  return aboveCurve.map(p => {
    const eligible = p.mean > 0 && p.cv < 35 && p.n >= 20;
    let suggestion;
    if (eligible) {
      const winRate = p.winRate / 100;
      const avgWin  = p.mean + p.std * 0.5;
      const avgLoss = Math.abs(p.mean - p.std * 0.5);
      const kellyFull = avgLoss > 0 ? (winRate / avgLoss - (1 - winRate) / avgWin) : 0;
      const kellyQuarter = Math.max(0, kellyFull * 0.25);
      const newRisk = Math.min(1.0 + kellyQuarter, 2.0);
      suggestion = { eligible: true, newRiskPct: newRisk.toFixed(2), kellyFraction: (kellyQuarter * 100).toFixed(1) };
    } else {
      const reasons = [];
      if (p.mean <= 0) reasons.push("negative expectation");
      if (p.cv >= 35) reasons.push(`CV ${p.cv}% ≥ 35%`);
      if (p.n < 20) reasons.push(`only ${p.n} samples (need 20+)`);
      suggestion = { eligible: false, reasons };
    }
    return { ...p, suggestion };
  });
}

// ─── COLOUR SYSTEM ────────────────────────────────────────────────────────────
const CLR = {
  bg0: "#070D18", bg1: "#0D1626", bg2: "#111E32", bg3: "#162540",
  border: "#1C2E47", borderLt: "#243857",
  blue: "#3B82F6", blueD: "#1D4ED8", blueLt: "#93C5FD",
  green: "#10B981", greenD: "#047857", greenLt: "#6EE7B7",
  amber: "#F59E0B", amberD: "#B45309", amberLt: "#FCD34D",
  red: "#EF4444", redD: "#B91C1C", redLt: "#FCA5A5",
  purple: "#8B5CF6", teal: "#14B8A6",
  slate: "#64748B", slateL: "#94A3B8", white: "#F1F5F9",
};

// ─── REUSABLE UI ──────────────────────────────────────────────────────────────
const Card = ({ children, style = {} }) => (
  <div style={{ background: CLR.bg1, border: `1px solid ${CLR.border}`,
    borderRadius: 10, padding: 20, ...style }}>{children}</div>
);

const Label = ({ children, color = CLR.slateL }) => (
  <div style={{ fontFamily: "monospace", fontSize: 10, letterSpacing: 2,
    textTransform: "uppercase", color, marginBottom: 8 }}>{children}</div>
);

const Stat = ({ label, value, sub, color = CLR.white, accent = CLR.blue }) => (
  <div style={{ background: CLR.bg2, border: `1px solid ${CLR.border}`,
    borderTop: `2px solid ${accent}`, borderRadius: 8, padding: "12px 16px" }}>
    <div style={{ fontFamily: "monospace", fontSize: 9, letterSpacing: 2,
      color: CLR.slate, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "monospace",
      letterSpacing: -0.5 }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color: CLR.slate, marginTop: 4,
      fontFamily: "monospace" }}>{sub}</div>}
  </div>
);

const Pill = ({ children, color }) => (
  <span style={{ background: color + "22", color, border: `1px solid ${color}44`,
    borderRadius: 4, padding: "2px 8px", fontSize: 10, fontFamily: "monospace",
    letterSpacing: 1 }}>{children}</span>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: CLR.bg2, border: `1px solid ${CLR.borderLt}`,
      borderRadius: 8, padding: "10px 14px", fontSize: 11, fontFamily: "monospace" }}>
      <div style={{ color: CLR.slateL, marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || CLR.white }}>
          {p.name}: {typeof p.value === "number"
            ? (p.name?.toLowerCase().includes("₦") || p.name?.toLowerCase().includes("pnl") || p.name?.toLowerCase().includes("mean") || p.name?.toLowerCase().includes("std") || p.name?.includes("MR") || p.name?.includes("MC") || p.name?.includes("TC") || p.name?.includes("AC")
              ? `₦${p.value.toLocaleString()}` : p.value)
            : p.value}
        </div>
      ))}
    </div>
  );
};

// ─── TABS ─────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "today",    label: "Today vs Average" },
  { id: "marginal", label: "Marginal Curves" },
  { id: "economics", label: "Economics" },
  { id: "sigma",    label: "σ Stabilisation" },
  { id: "suggest",  label: "Suggestions" },
];

const CAPITAL = 150000;

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function MarginalViz() {
  const [tab, setTab] = useState("today");
  const [dataSource, setDataSource] = useState("synthetic"); // "synthetic" | "real"
  const [thresholdPct, setThresholdPct] = useState(1.0); // 0.5 – 5.0
  const [selectedDay, setSelectedDay] = useState(null); // null = auto-pick near end

  const threshold = CAPITAL * (thresholdPct / 100);

  // Build days from selected data source + current threshold
  const days = useMemo(() => {
    if (dataSource === "real") {
      return buildDaysFromRawTrades(MT5_RAW_TRADES, threshold);
    }
    return generateSyntheticDays(60, threshold);
  }, [dataSource, threshold]);

  // Auto-pick selectedDay when data source changes
  const dayIdx = selectedDay !== null && selectedDay <= days.length ? selectedDay : Math.max(1, days.length - 1);

  const { belowCurve, aboveCurve } = useMemo(() => computeMarginalCurves(days), [days]);
  const economicsData = useMemo(() => computeEconomicsCurves(belowCurve, aboveCurve), [belowCurve, aboveCurve]);
  const cvOverTime = useMemo(() => computeCVOverTime(days), [days]);
  const suggestData = useMemo(() => computeSuggestion(aboveCurve), [aboveCurve]);

  const today = days[dayIdx - 1] || days[0];

  const todaySeries = useMemo(() => {
    let cum = 0;
    return today.trades.map(t => {
      cum += t.pnl;
      return {
        label: t.aboveThreshold ? `+${t.aboveIndex}` : `T${t.tradeIndex}`,
        tradeIndex: t.tradeIndex, pnl: t.pnl, cumPnL: cum,
        above: t.aboveThreshold,
        symbol: t.symbol || "", type: t.type || "",
      };
    });
  }, [today]);

  const combinedMarginal = useMemo(() => {
    const allPos = [
      ...belowCurve.map(b => ({ ...b, zone: "below" })),
      ...aboveCurve.map(a => ({ ...a, zone: "above", posNum: a.posNum + belowCurve.length })),
    ];
    return allPos.map(p => {
      const todayTrade = today.trades.find(t =>
        p.zone === "below"
          ? t.tradeIndex === p.posNum && !t.aboveThreshold
          : t.aboveThreshold && t.aboveIndex === (p.posNum - belowCurve.length)
      );
      return {
        position: p.position, zone: p.zone, mean: p.mean,
        upper1: p.mean + p.std, lower1: p.mean - p.std,
        upper2: p.mean + p.std * 2, lower2: p.mean - p.std * 2,
        todayPnL: todayTrade ? todayTrade.pnl : null, cv: p.cv, n: p.n,
      };
    });
  }, [belowCurve, aboveCurve, today]);

  const totalDays = days.length;
  const daysWithAbove = days.filter(d => d.thresholdHit).length;
  const totalTrades = days.reduce((s, d) => s + d.trades.length, 0);
  const avgAboveTrades = daysWithAbove > 0
    ? (days.reduce((s, d) => s + d.trades.filter(t => t.aboveThreshold).length, 0) / daysWithAbove).toFixed(1)
    : "0";

  const cvChartData = useMemo(() => {
    const lens = Object.values(cvOverTime).map(a => a.length);
    const maxLen = Math.max(...lens, 0);
    if (maxLen === 0) return [];
    return Array.from({ length: maxLen }, (_, i) => ({
      day: cvOverTime[1]?.[i]?.day || cvOverTime[2]?.[i]?.day || cvOverTime[3]?.[i]?.day || i + 1,
      "Pos +1": cvOverTime[1]?.[i]?.cv,
      "Pos +2": cvOverTime[2]?.[i]?.cv,
      "Pos +3": cvOverTime[3]?.[i]?.cv,
    }));
  }, [cvOverTime]);

  // Find MR=MC intersection for economics tab
  const mrMcIntersection = useMemo(() => {
    const aboveEcon = economicsData.filter(p => p.zone === "above");
    for (let i = 0; i < aboveEcon.length; i++) {
      if (aboveEcon[i].mc >= aboveEcon[i].mr) {
        return { position: aboveEcon[i].position, index: i, mr: aboveEcon[i].mr, mc: aboveEcon[i].mc };
      }
    }
    return null;
  }, [economicsData]);

  const totalSurplus = useMemo(() => {
    return economicsData.reduce((s, p) => s + Math.max(0, p.surplus), 0);
  }, [economicsData]);

  const isReal = dataSource === "real";

  const sectionLabel = (text) => (
    <div style={{ borderLeft: `3px solid ${CLR.blue}`, paddingLeft: 12, marginBottom: 16 }}>
      <div style={{ fontFamily: "monospace", fontSize: 9, color: CLR.slate,
        letterSpacing: 3, textTransform: "uppercase", marginBottom: 2 }}>Analysis</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: CLR.white }}>{text}</div>
    </div>
  );

  return (
    <div style={{ background: CLR.bg0, minHeight: "100vh", color: CLR.white,
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif", padding: "24px 20px" }}>

      {/* HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        marginBottom: 20, paddingBottom: 20, borderBottom: `1px solid ${CLR.border}` }}>
        <div>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: CLR.blue,
            letterSpacing: 3, textTransform: "uppercase", marginBottom: 6 }}>
            Marginal Trade Profit {isReal ? "· Real MT5 Data" : "· Synthetic Test Data"}
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: CLR.white, letterSpacing: -0.5 }}>
            Excess Trade Analytics
          </div>
          <div style={{ fontSize: 12, color: CLR.slate, marginTop: 4, fontFamily: "monospace" }}>
            Capital ₦{CAPITAL.toLocaleString()} · Threshold {thresholdPct.toFixed(1)}% = ₦{Math.round(threshold).toLocaleString()}/day · {totalDays} trading days · {totalTrades} trades
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Pill color={isReal ? CLR.green : CLR.amber}>{isReal ? "REAL DATA" : "SYNTHETIC"}</Pill>
          <Pill color={CLR.blue}>{totalDays} DAYS</Pill>
        </div>
      </div>

      {/* CONTROLS BAR */}
      <div style={{ display: "flex", gap: 24, alignItems: "center", marginBottom: 20,
        background: CLR.bg1, border: `1px solid ${CLR.border}`, borderRadius: 8, padding: "12px 16px" }}>
        {/* Data source toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "monospace", fontSize: 10, color: CLR.slate, letterSpacing: 2 }}>DATA SOURCE</span>
          <div style={{ display: "flex", background: CLR.bg2, borderRadius: 6, overflow: "hidden", border: `1px solid ${CLR.border}` }}>
            {[["synthetic", "SYNTHETIC (60D)"], ["real", "REAL MT5 (10D)"]].map(([key, label]) => (
              <button key={key} onClick={() => { setDataSource(key); setSelectedDay(null); }} style={{
                fontFamily: "monospace", fontSize: 10, letterSpacing: 1, padding: "6px 14px",
                background: dataSource === key ? (key === "real" ? CLR.green + "33" : CLR.blue + "33") : "transparent",
                border: "none", color: dataSource === key ? CLR.white : CLR.slate,
                cursor: "pointer", transition: "all 0.15s",
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* Threshold slider */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
          <span style={{ fontFamily: "monospace", fontSize: 10, color: CLR.slate, letterSpacing: 2 }}>THRESHOLD</span>
          <input type="range" min={0.5} max={5.0} step={0.1} value={thresholdPct}
            onChange={e => setThresholdPct(Number(e.target.value))}
            style={{ width: 180, accentColor: CLR.amber }} />
          <div style={{ fontFamily: "monospace", fontSize: 13, color: CLR.amber, fontWeight: 700, minWidth: 120 }}>
            {thresholdPct.toFixed(1)}% = ₦{Math.round(threshold).toLocaleString()}
          </div>
        </div>
      </div>

      {/* REAL DATA WARNING */}
      {isReal && (
        <div style={{ background: CLR.amber + "11", border: `1px solid ${CLR.amber}33`,
          borderLeft: `3px solid ${CLR.amber}`, borderRadius: 8, padding: "10px 16px",
          marginBottom: 16, fontFamily: "monospace", fontSize: 11, color: CLR.amberLt }}>
          {totalDays} trading days / {totalTrades} trades — statistical significance limited. Collect 30+ days before acting on suggestions.
        </div>
      )}

      {/* SUMMARY STATS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 24 }}>
        <Stat label="Total Days" value={totalDays} sub={isReal ? "real trading" : "simulated"} accent={CLR.blue} />
        <Stat label="Days Threshold Hit" value={daysWithAbove}
          sub={`${totalDays > 0 ? Math.round(daysWithAbove/totalDays*100) : 0}% of days`} accent={CLR.green} />
        <Stat label="Avg Excess Trades" value={avgAboveTrades}
          sub="per threshold day" accent={CLR.amber} />
        <Stat label="Threshold" value={`₦${Math.round(threshold).toLocaleString()}`}
          sub={`${thresholdPct.toFixed(1)}% of ₦${CAPITAL.toLocaleString()}`} accent={CLR.teal} />
        <Stat label="Above-Threshold Pos." value={aboveCurve.length}
          sub="positions with data" accent={CLR.purple} />
      </div>

      {/* TABS */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24,
        borderBottom: `1px solid ${CLR.border}`, paddingBottom: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            fontFamily: "monospace", fontSize: 11, letterSpacing: 1,
            padding: "8px 16px", background: "transparent", border: "none",
            borderBottom: tab === t.id ? `2px solid ${CLR.blue}` : "2px solid transparent",
            color: tab === t.id ? CLR.blue : CLR.slate, cursor: "pointer",
            transition: "all 0.15s",
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── TAB: TODAY VS AVERAGE ── */}
      {tab === "today" && (
        <div>
          {sectionLabel(`Day ${dayIdx}${today.date ? ` (${today.date})` : ""} — Cumulative P&L vs Historical Mean`)}

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <span style={{ fontFamily: "monospace", fontSize: 11, color: CLR.slateL }}>Select Day:</span>
            <input type="range" min={1} max={totalDays} value={dayIdx}
              onChange={e => setSelectedDay(Number(e.target.value))}
              style={{ width: 200, accentColor: CLR.blue }} />
            <div style={{ display: "flex", gap: 8 }}>
              <Pill color={today.thresholdHit ? CLR.green : CLR.slate}>
                {today.thresholdHit ? "THRESHOLD HIT" : "BELOW THRESHOLD"}
              </Pill>
              <Pill color={today.finalPnL >= 0 ? CLR.green : CLR.red}>
                {today.finalPnL >= 0 ? "+" : ""}₦{today.finalPnL.toLocaleString()}
              </Pill>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Card>
              <Label>Today's Cumulative P&L</Label>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={todaySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CLR.border} />
                  <XAxis dataKey="label" tick={{ fill: CLR.slate, fontSize: 10, fontFamily: "monospace" }} />
                  <YAxis tick={{ fill: CLR.slate, fontSize: 10 }}
                    tickFormatter={v => `₦${(v/1000).toFixed(1)}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={threshold} stroke={CLR.amber} strokeDasharray="6 3"
                    label={{ value: "Threshold", fill: CLR.amber, fontSize: 10 }} />
                  <ReferenceLine y={0} stroke={CLR.slate} strokeWidth={1} />
                  <Area type="stepAfter" dataKey="cumPnL" name="Cum P&L ₦"
                    stroke={CLR.blue} fill={CLR.blue} fillOpacity={0.1} strokeWidth={2}
                    dot={{ fill: CLR.blue, r: 5 }} />
                </ComposedChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {todaySeries.map((t, i) => (
                  <div key={i} style={{
                    background: t.above ? (t.pnl >= 0 ? CLR.green + "22" : CLR.red + "22") : CLR.bg2,
                    border: `1px solid ${t.above ? (t.pnl >= 0 ? CLR.green : CLR.red) : CLR.border}44`,
                    borderRadius: 6, padding: "4px 10px", fontSize: 11, fontFamily: "monospace",
                    color: t.pnl >= 0 ? CLR.greenLt : CLR.redLt,
                  }}>
                    {t.label}: {t.pnl >= 0 ? "+" : ""}₦{t.pnl.toLocaleString()}
                    {t.symbol && <span style={{ color: CLR.slate, marginLeft: 4 }}>{t.symbol}</span>}
                    {t.above && <span style={{ color: CLR.amber, marginLeft: 4 }}>★</span>}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: CLR.slate, marginTop: 8, fontFamily: "monospace" }}>
                ★ = above-threshold trades
              </div>
            </Card>

            <Card>
              <Label>Today's Trades vs Historical Mean ± σ</Label>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={combinedMarginal}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CLR.border} />
                  <XAxis dataKey="position" tick={{ fill: CLR.slate, fontSize: 10, fontFamily: "monospace" }} />
                  <YAxis tick={{ fill: CLR.slate, fontSize: 10 }} tickFormatter={v => `₦${v}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke={CLR.slate} strokeWidth={1} />
                  <Area type="monotone" dataKey="upper2" name="upper2"
                    stroke="transparent" fill={CLR.blue} fillOpacity={0.05} legendType="none" />
                  <Area type="monotone" dataKey="lower2" name="lower2"
                    stroke="transparent" fill={CLR.bg0} fillOpacity={1} legendType="none" />
                  <Area type="monotone" dataKey="upper1" name="+1σ"
                    stroke={CLR.blue + "40"} fill={CLR.blue} fillOpacity={0.12} strokeWidth={1} strokeDasharray="3 2" />
                  <Area type="monotone" dataKey="lower1" name="−1σ"
                    stroke={CLR.blue + "40"} fill={CLR.bg0} fillOpacity={1} strokeWidth={1} strokeDasharray="3 2" />
                  <Line type="monotone" dataKey="mean" name="Mean ₦"
                    stroke={CLR.blue} strokeWidth={2.5} dot={{ r: 4, fill: CLR.blue }} />
                  <Line type="monotone" dataKey="todayPnL" name="Today ₦"
                    stroke={CLR.amber} strokeWidth={0}
                    dot={{ r: 6, fill: CLR.amber, strokeWidth: 2, stroke: CLR.bg0 }}
                    connectNulls={false} />
                  {belowCurve.length > 0 && (
                    <ReferenceLine x={belowCurve[belowCurve.length - 1]?.position}
                      stroke={CLR.amber} strokeDasharray="4 3"
                      label={{ value: "→ THRESHOLD", fill: CLR.amber, fontSize: 9, position: "insideTopRight" }} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                {[["─── Mean", CLR.blue], ["● Today", CLR.amber], ["▓ ±1σ", CLR.blue + "80"]].map(([l, c]) => (
                  <span key={l} style={{ fontSize: 10, color: c, fontFamily: "monospace" }}>{l}</span>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ── TAB: MARGINAL CURVES ── */}
      {tab === "marginal" && (
        <div>
          {sectionLabel("Historical Marginal Profit — Below vs Above Threshold")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Card>
              <Label color={CLR.green}>Below Threshold — Standard Diminishing Returns</Label>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={belowCurve}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CLR.border} />
                  <XAxis dataKey="position" tick={{ fill: CLR.slate, fontSize: 10, fontFamily: "monospace" }} />
                  <YAxis tick={{ fill: CLR.slate, fontSize: 10 }} tickFormatter={v => `₦${v}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke={CLR.slate} />
                  <Bar dataKey="mean" name="Mean ₦" fill={CLR.green} fillOpacity={0.7} radius={[3,3,0,0]} />
                  <Line type="monotone" dataKey="mean" name="Trend"
                    stroke={CLR.greenLt} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 10 }}>
                {belowCurve.slice(0, 6).map(p => (
                  <div key={p.position} style={{ background: CLR.bg2, borderRadius: 6,
                    padding: "8px 10px", border: `1px solid ${CLR.border}` }}>
                    <div style={{ fontFamily: "monospace", fontSize: 10, color: CLR.slateL }}>{p.position}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: p.mean >= 0 ? CLR.green : CLR.red }}>
                      ₦{p.mean.toLocaleString()}</div>
                    <div style={{ fontSize: 10, color: CLR.slate, fontFamily: "monospace" }}>σ ₦{p.std} · n={p.n}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <Label color={CLR.amber}>Above Threshold — Excess Trade Analysis</Label>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={aboveCurve}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CLR.border} />
                  <XAxis dataKey="position" tick={{ fill: CLR.slate, fontSize: 10, fontFamily: "monospace" }} />
                  <YAxis tick={{ fill: CLR.slate, fontSize: 10 }} tickFormatter={v => `₦${v}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke={CLR.red} strokeWidth={1.5}
                    label={{ value: "Break-even", fill: CLR.red, fontSize: 9 }} />
                  <Bar dataKey="mean" name="Mean ₦" radius={[3,3,0,0]} fill={CLR.amber} fillOpacity={0.7} />
                  <Line type="monotone" dataKey="mean" name="Trend"
                    stroke={CLR.amberLt} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 10 }}>
                {aboveCurve.map(p => (
                  <div key={p.position} style={{
                    background: p.mean >= 0 ? CLR.green + "11" : CLR.red + "11",
                    borderRadius: 6, padding: "8px 10px",
                    border: `1px solid ${p.mean >= 0 ? CLR.green : CLR.red}33` }}>
                    <div style={{ fontFamily: "monospace", fontSize: 10, color: CLR.slateL }}>{p.position}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: p.mean >= 0 ? CLR.green : CLR.red }}>
                      ₦{p.mean.toLocaleString()}</div>
                    <div style={{ fontSize: 10, color: CLR.slate, fontFamily: "monospace" }}>
                      σ ₦{p.std} · CV {p.cv}% · n={p.n}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card style={{ marginTop: 16 }}>
            <Label>Full Sequence — Below + Above Threshold Mean Marginal</Label>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={combinedMarginal}>
                <CartesianGrid strokeDasharray="3 3" stroke={CLR.border} />
                <XAxis dataKey="position" tick={{ fill: CLR.slate, fontSize: 10, fontFamily: "monospace" }} />
                <YAxis tick={{ fill: CLR.slate, fontSize: 10 }} tickFormatter={v => `₦${v}`} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={0} stroke={CLR.slate} strokeWidth={1.5} />
                <Area type="monotone" dataKey="upper1" name="+1σ"
                  stroke={CLR.blue + "33"} fill={CLR.blue} fillOpacity={0.08} strokeDasharray="3 2" />
                <Area type="monotone" dataKey="lower1" name="−1σ"
                  stroke={CLR.blue + "33"} fill={CLR.bg0} fillOpacity={1} strokeDasharray="3 2" />
                <Line type="monotone" dataKey="mean" name="Mean Marginal ₦"
                  stroke={CLR.blue} strokeWidth={2.5}
                  dot={(props) => {
                    const { cx, cy, payload } = props;
                    const color = payload.zone === "above"
                      ? (payload.mean >= 0 ? CLR.amber : CLR.red)
                      : CLR.green;
                    return <circle key={cx} cx={cx} cy={cy} r={5} fill={color} stroke={CLR.bg0} strokeWidth={2} />;
                  }} />
                {belowCurve.length > 0 && (
                  <ReferenceLine x={belowCurve[belowCurve.length-1]?.position}
                    stroke={CLR.amber} strokeDasharray="6 3" strokeWidth={2}
                    label={{ value: "THRESHOLD →", fill: CLR.amber, fontSize: 10, position: "insideTopLeft" }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
              {[["● Below threshold", CLR.green], ["● Above threshold (+)", CLR.amber],
                ["● Above threshold (−)", CLR.red], ["▓ ±1σ band", CLR.blue + "80"]].map(([l,c]) => (
                <span key={l} style={{ fontSize: 10, color: c, fontFamily: "monospace" }}>{l}</span>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ── TAB: ECONOMICS ── */}
      {tab === "economics" && (
        <div>
          {sectionLabel("Trade Economics — MR, MC, TC, AC Curves")}

          <div style={{ background: CLR.bg2, border: `1px solid ${CLR.border}`, borderRadius: 8,
            padding: "10px 16px", marginBottom: 16, display: "flex", gap: 20, alignItems: "center" }}>
            <div style={{ width: 3, height: 36, background: CLR.purple, borderRadius: 2 }} />
            <div>
              <div style={{ fontFamily: "monospace", fontSize: 10, color: CLR.purple, letterSpacing: 2 }}>ECONOMIC MODEL</div>
              <div style={{ fontSize: 12, color: CLR.slateL, marginTop: 2 }}>
                MR = mean gross P&L at each position. MC = opportunity cost (locked profit × loss rate). Below threshold MC = ₦0.
                Optimal stopping point: where MC ≥ MR.
              </div>
            </div>
          </div>

          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
            <Stat label="Total Economic Surplus" value={`₦${totalSurplus.toLocaleString()}`}
              sub="sum of (MR−MC) where positive" accent={CLR.green} />
            <Stat label="MR=MC Intersection"
              value={mrMcIntersection ? mrMcIntersection.position : "None"}
              sub={mrMcIntersection ? "optimal stopping point" : "MR > MC everywhere"}
              accent={CLR.red} />
            <Stat label="Below-Threshold Positions" value={belowCurve.length}
              sub="MC = ₦0 (no opportunity cost)" accent={CLR.blue} />
            <Stat label="Above-Threshold Positions" value={aboveCurve.length}
              sub="MC > 0 (locked profit at risk)" accent={CLR.amber} />
          </div>

          {/* Main chart: MR and MC */}
          <Card>
            <Label>Marginal Revenue (MR) vs Marginal Cost (MC)</Label>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={economicsData}>
                <CartesianGrid strokeDasharray="3 3" stroke={CLR.border} />
                <XAxis dataKey="position" tick={{ fill: CLR.slate, fontSize: 10, fontFamily: "monospace" }} />
                <YAxis tick={{ fill: CLR.slate, fontSize: 10 }} tickFormatter={v => `₦${v.toLocaleString()}`} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={0} stroke={CLR.slate} strokeWidth={1} />

                {/* Surplus area (MR - MC) where positive */}
                <Area type="monotone" dataKey="mr" name="MR (Mean P&L) ₦"
                  stroke="transparent" fill={CLR.green} fillOpacity={0.08} />

                {/* MR line */}
                <Line type="monotone" dataKey="mr" name="MR (Mean P&L) ₦"
                  stroke={CLR.blue} strokeWidth={2.5}
                  dot={(props) => {
                    const { cx, cy, payload } = props;
                    const color = payload.zone === "above" ? CLR.amber : CLR.green;
                    return <circle key={`mr-${cx}`} cx={cx} cy={cy} r={5} fill={color} stroke={CLR.bg0} strokeWidth={2} />;
                  }} />

                {/* MC line */}
                <Line type="monotone" dataKey="mc" name="MC (Opp. Cost) ₦"
                  stroke={CLR.red} strokeWidth={2.5} strokeDasharray="6 3"
                  dot={{ r: 4, fill: CLR.red, stroke: CLR.bg0, strokeWidth: 2 }} />

                {/* Threshold divider */}
                {belowCurve.length > 0 && (
                  <ReferenceLine x={belowCurve[belowCurve.length-1]?.position}
                    stroke={CLR.amber} strokeDasharray="6 3" strokeWidth={2}
                    label={{ value: "THRESHOLD →", fill: CLR.amber, fontSize: 10, position: "insideTopLeft" }} />
                )}

                {/* MR=MC intersection */}
                {mrMcIntersection && (
                  <ReferenceLine x={mrMcIntersection.position}
                    stroke={CLR.purple} strokeDasharray="4 2" strokeWidth={2}
                    label={{ value: "MR=MC STOP", fill: CLR.purple, fontSize: 9, position: "insideTopRight" }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
              {[["─── MR (Mean P&L)", CLR.blue], ["--- MC (Opp. Cost)", CLR.red],
                ["│ Threshold", CLR.amber], ["│ Optimal Stop", CLR.purple]].map(([l,c]) => (
                <span key={l} style={{ fontSize: 10, color: c, fontFamily: "monospace" }}>{l}</span>
              ))}
            </div>
          </Card>

          {/* TC and AC chart */}
          <Card style={{ marginTop: 16 }}>
            <Label>Total Cost (TC) and Average Cost (AC)</Label>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={economicsData}>
                <CartesianGrid strokeDasharray="3 3" stroke={CLR.border} />
                <XAxis dataKey="position" tick={{ fill: CLR.slate, fontSize: 10, fontFamily: "monospace" }} />
                <YAxis tick={{ fill: CLR.slate, fontSize: 10 }} tickFormatter={v => `₦${v.toLocaleString()}`} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={0} stroke={CLR.slate} strokeWidth={1} />

                {/* TC area */}
                <Area type="monotone" dataKey="tc" name="TC (Total Cost) ₦"
                  stroke={CLR.red} fill={CLR.red} fillOpacity={0.1} strokeWidth={2} />

                {/* AC line */}
                <Line type="monotone" dataKey="ac" name="AC (Avg Cost) ₦"
                  stroke={CLR.amber} strokeWidth={2} strokeDasharray="6 3"
                  dot={{ r: 3, fill: CLR.amber }} />

                {/* MR for reference */}
                <Line type="monotone" dataKey="mr" name="MR (for reference) ₦"
                  stroke={CLR.blue} strokeWidth={1.5} strokeDasharray="3 2"
                  dot={false} />

                {belowCurve.length > 0 && (
                  <ReferenceLine x={belowCurve[belowCurve.length-1]?.position}
                    stroke={CLR.amber} strokeDasharray="6 3" strokeWidth={2} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
              {[["▓ TC (Total Cost)", CLR.red], ["--- AC (Avg Cost)", CLR.amber],
                ["--- MR (reference)", CLR.blue]].map(([l,c]) => (
                <span key={l} style={{ fontSize: 10, color: c, fontFamily: "monospace" }}>{l}</span>
              ))}
            </div>
          </Card>

          {/* Position detail table */}
          <Card style={{ marginTop: 16 }}>
            <Label>Economics by Position</Label>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${CLR.border}` }}>
                    {["Position", "Zone", "n", "MR (₦)", "MC (₦)", "TC (₦)", "AC (₦)", "Surplus (₦)"].map(h => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: CLR.slate,
                        fontSize: 9, letterSpacing: 2, textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {economicsData.map((p, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${CLR.border}22` }}>
                      <td style={{ padding: "6px 10px", color: CLR.white, fontWeight: 700 }}>{p.position}</td>
                      <td style={{ padding: "6px 10px" }}>
                        <Pill color={p.zone === "above" ? CLR.amber : CLR.green}>
                          {p.zone === "above" ? "ABOVE" : "BELOW"}
                        </Pill>
                      </td>
                      <td style={{ padding: "6px 10px", color: CLR.slateL }}>{p.n}</td>
                      <td style={{ padding: "6px 10px", color: p.mr >= 0 ? CLR.green : CLR.red }}>
                        {p.mr >= 0 ? "+" : ""}₦{p.mr.toLocaleString()}</td>
                      <td style={{ padding: "6px 10px", color: p.mc > 0 ? CLR.red : CLR.slateL }}>
                        ₦{p.mc.toLocaleString()}</td>
                      <td style={{ padding: "6px 10px", color: CLR.slateL }}>₦{p.tc.toLocaleString()}</td>
                      <td style={{ padding: "6px 10px", color: CLR.slateL }}>₦{p.ac.toLocaleString()}</td>
                      <td style={{ padding: "6px 10px", color: p.surplus >= 0 ? CLR.green : CLR.red, fontWeight: 700 }}>
                        {p.surplus >= 0 ? "+" : ""}₦{p.surplus.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ── TAB: SIGMA STABILISATION ── */}
      {tab === "sigma" && (
        <div>
          {sectionLabel("Coefficient of Variation Over Time — Stabilisation")}
          <div style={{ background: CLR.bg2, border: `1px solid ${CLR.border}`, borderRadius: 8,
            padding: "10px 16px", marginBottom: 16, display: "flex", gap: 20, alignItems: "center" }}>
            <div style={{ width: 3, height: 36, background: CLR.amber, borderRadius: 2 }} />
            <div>
              <div style={{ fontFamily: "monospace", fontSize: 10, color: CLR.amber, letterSpacing: 2 }}>STABILISATION THRESHOLD</div>
              <div style={{ fontSize: 12, color: CLR.slateL, marginTop: 2 }}>
                CV below 35% = distribution stable enough for size increase suggestion.
                Watch how each position converges as data accumulates over days.
              </div>
            </div>
          </div>

          {cvChartData.length > 0 ? (
            <Card>
              <Label>CV % by Above-Threshold Position — Rolling as Days Accumulate</Label>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={cvChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CLR.border} />
                  <XAxis dataKey="day" tick={{ fill: CLR.slate, fontSize: 10, fontFamily: "monospace" }}
                    label={{ value: "Day", fill: CLR.slate, fontSize: 10, position: "insideBottom", offset: -2 }} />
                  <YAxis tick={{ fill: CLR.slate, fontSize: 10 }} tickFormatter={v => `${v}%`}
                    label={{ value: "CV %", fill: CLR.slate, fontSize: 10, angle: -90, position: "insideLeft" }} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={35} stroke={CLR.amber} strokeDasharray="8 4" strokeWidth={2}
                    label={{ value: "35% Threshold", fill: CLR.amber, fontSize: 10 }} />
                  <Line type="monotone" dataKey="Pos +1" stroke={CLR.green} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Pos +2" stroke={CLR.blue} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Pos +3" stroke={CLR.purple} strokeWidth={2} dot={false} />
                  <Legend wrapperStyle={{ fontSize: 11, fontFamily: "monospace" }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          ) : (
            <Card>
              <div style={{ textAlign: "center", padding: 40, color: CLR.slate, fontFamily: "monospace" }}>
                Not enough data for CV over time chart. Need at least 3 samples per position.
              </div>
            </Card>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 16 }}>
            {[1,2,3].map(pos => {
              const data = cvOverTime[pos] || [];
              const latest = data[data.length - 1];
              const early  = data[0];
              const color  = pos === 1 ? CLR.green : pos === 2 ? CLR.blue : CLR.purple;
              const stable = latest?.cv < 35;
              const hasData = data.length > 0;
              return (
                <Card key={pos} style={{ borderTop: `2px solid ${color}` }}>
                  <div style={{ fontFamily: "monospace", fontSize: 10, color, letterSpacing: 2, marginBottom: 8 }}>
                    POSITION +{pos} ABOVE THRESHOLD
                  </div>
                  {hasData ? (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 9, color: CLR.slate, fontFamily: "monospace" }}>EARLY CV</div>
                          <div style={{ fontSize: 20, fontWeight: 700, color: CLR.red }}>{early?.cv}%</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: CLR.slate, fontFamily: "monospace" }}>CURRENT CV</div>
                          <div style={{ fontSize: 20, fontWeight: 700, color: stable ? CLR.green : CLR.amber }}>
                            {latest?.cv}%</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <Pill color={stable ? CLR.green : CLR.amber}>
                          {stable ? "STABLE — ELIGIBLE" : "STABILISING"}
                        </Pill>
                      </div>
                      <div style={{ height: 4, background: CLR.bg3, borderRadius: 2, marginTop: 10, overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(100, Math.max(0, (150 - (latest?.cv || 150)) / 1.5))}%`,
                          height: "100%", background: stable ? CLR.green : CLR.amber, transition: "width 0.5s" }} />
                      </div>
                      <div style={{ fontSize: 10, color: CLR.slate, marginTop: 4, fontFamily: "monospace" }}>
                        n = {latest?.n || 0} samples · mean ₦{latest?.mean?.toLocaleString()}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 11, color: CLR.slate, fontFamily: "monospace", padding: "10px 0" }}>
                      Insufficient data (need 3+ samples)
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB: SUGGESTIONS ── */}
      {tab === "suggest" && (
        <div>
          {sectionLabel("System Suggestions — Quarter-Kelly Lot Size Increases")}
          <div style={{ background: CLR.bg2, border: `1px solid ${CLR.blue}22`,
            borderLeft: `3px solid ${CLR.blue}`, borderRadius: 8,
            padding: "12px 16px", marginBottom: 20, fontSize: 13, color: CLR.slateL }}>
            Suggestions are generated only when three conditions are simultaneously met:
            <strong style={{ color: CLR.white }}> mean marginal &gt; 0</strong>,
            <strong style={{ color: CLR.amber }}> CV &lt; 35%</strong>, and
            <strong style={{ color: CLR.green }}> ≥ 20 data samples</strong>.
            Sizing uses ¼-Kelly fraction applied to current {thresholdPct.toFixed(1)}% base risk.
          </div>

          {suggestData.length === 0 ? (
            <Card>
              <div style={{ textAlign: "center", padding: 40, color: CLR.slate, fontFamily: "monospace" }}>
                No above-threshold positions found at the current threshold level.
                {isReal && " Collecting more trading data will populate this view."}
              </div>
            </Card>
          ) : suggestData.map(p => {
            const s = p.suggestion;
            const eligible = s.eligible;
            return (
              <Card key={p.position} style={{ marginBottom: 12,
                borderLeft: `3px solid ${eligible ? CLR.green : CLR.slate}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 20, fontWeight: 700, color: CLR.white,
                        fontFamily: "monospace" }}>Position {p.position}</span>
                      <Pill color={eligible ? CLR.green : CLR.slate}>
                        {eligible ? "INCREASE ELIGIBLE" : "NOT YET ELIGIBLE"}</Pill>
                      <Pill color={p.mean >= 0 ? CLR.green : CLR.red}>
                        Mean ₦{p.mean?.toLocaleString()}</Pill>
                    </div>
                    <div style={{ display: "flex", gap: 24, fontSize: 12, fontFamily: "monospace", color: CLR.slateL }}>
                      <span>σ = ₦{p.std?.toLocaleString()}</span>
                      <span style={{ color: p.cv < 35 ? CLR.green : CLR.amber }}>CV = {p.cv}%</span>
                      <span>Win Rate = {p.winRate}%</span>
                      <span>n = {p.n} samples</span>
                    </div>
                  </div>
                  {eligible && (
                    <div style={{ background: CLR.green + "11",
                      border: `1px solid ${CLR.green}44`, borderRadius: 8,
                      padding: "12px 20px", textAlign: "right" }}>
                      <div style={{ fontFamily: "monospace", fontSize: 9, color: CLR.green, letterSpacing: 2 }}>SUGGESTED RISK</div>
                      <div style={{ fontSize: 28, fontWeight: 700, color: CLR.green }}>
                        {s.newRiskPct}%</div>
                      <div style={{ fontSize: 10, color: CLR.slate, fontFamily: "monospace" }}>
                        up from {thresholdPct.toFixed(2)}% · ¼-Kelly {s.kellyFraction}%</div>
                    </div>
                  )}
                </div>
                {!eligible && (
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {s.reasons.map((r, i) => (
                      <div key={i} style={{ background: CLR.red + "11",
                        border: `1px solid ${CLR.red}33`, borderRadius: 6,
                        padding: "4px 12px", fontSize: 11, fontFamily: "monospace", color: CLR.redLt }}>
                        ✗ {r}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 16, marginTop: 12, paddingTop: 12,
                  borderTop: `1px solid ${CLR.border}` }}>
                  {[
                    { label: "Mean > 0", pass: p.mean > 0 },
                    { label: "CV < 35%", pass: p.cv < 35 },
                    { label: "n ≥ 20",   pass: p.n >= 20 },
                  ].map(c => (
                    <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 16, height: 16, borderRadius: "50%", fontSize: 10,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: c.pass ? CLR.green + "33" : CLR.red + "22",
                        color: c.pass ? CLR.green : CLR.red }}>
                        {c.pass ? "✓" : "✗"}
                      </div>
                      <span style={{ fontFamily: "monospace", fontSize: 11,
                        color: c.pass ? CLR.greenLt : CLR.slateL }}>{c.label}</span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}

          <Card style={{ marginTop: 16, borderTop: `2px solid ${CLR.purple}` }}>
            <Label color={CLR.purple}>Quarter-Kelly Formula Explained</Label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div>
                <div style={{ fontFamily: "monospace", fontSize: 11, color: CLR.slateL, lineHeight: 1.8 }}>
                  <div>Full Kelly  =  (W/L) − ((1−W)/G)</div>
                  <div style={{ color: CLR.slate }}>Where:</div>
                  <div style={{ paddingLeft: 16 }}>W  = win rate at this position</div>
                  <div style={{ paddingLeft: 16 }}>L  = average loss magnitude</div>
                  <div style={{ paddingLeft: 16 }}>G  = average win magnitude</div>
                  <div style={{ marginTop: 8, color: CLR.amber }}>
                    ¼ Kelly = Full Kelly × 0.25</div>
                  <div style={{ color: CLR.amber }}>
                    (conservative — reduces ruin risk dramatically)</div>
                </div>
              </div>
              <div style={{ background: CLR.bg2, borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ fontFamily: "monospace", fontSize: 10, color: CLR.slateL,
                  letterSpacing: 2, marginBottom: 8 }}>HARD CAPS</div>
                {[
                  ["Max suggested risk / trade", "2.00%"],
                  ["Min samples before eligible", "20 days"],
                  ["Max CV for eligibility", "35%"],
                  ["Kelly fraction applied", "25% of full Kelly"],
                ].map(([l, v]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between",
                    fontSize: 12, fontFamily: "monospace", paddingBottom: 6,
                    borderBottom: `1px solid ${CLR.border}`, marginBottom: 6 }}>
                    <span style={{ color: CLR.slateL }}>{l}</span>
                    <span style={{ color: CLR.white, fontWeight: 700 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* FOOTER */}
      <div style={{ marginTop: 32, paddingTop: 16, borderTop: `1px solid ${CLR.border}`,
        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "monospace", fontSize: 10, color: CLR.slate }}>
          {isReal
            ? "REAL MT5 DATA · ACCOUNT 130965031 · EXNESS STANDARD"
            : "SYNTHETIC TEST DATA · NOT REAL TRADES · FOR VISUALISATION ONLY"}
        </span>
        <span style={{ fontFamily: "monospace", fontSize: 10, color: CLR.slate }}>
          {isReal ? "10 trading days · 37 trades · Jan–Mar 2026" : "Replace generateDays() with MT5 pull when live"}
        </span>
      </div>
    </div>
  );
}
