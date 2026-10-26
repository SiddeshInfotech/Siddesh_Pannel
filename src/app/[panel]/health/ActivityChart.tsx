'use client';

// The Activity area chart, split out of HealthClient so recharts loads only when there is a chart
// to draw (HealthClient imports this with next/dynamic).
import React from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/* eslint-disable @typescript-eslint/no-explicit-any -- action payloads */
export default function ActivityChart({ data, series }: { data: any[]; series: readonly (readonly [string, string, string])[] }) {
  return (
    <ResponsiveContainer><AreaChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
      <CartesianGrid strokeOpacity={0.1} vertical={false} /><XAxis dataKey="t" fontSize={10} minTickGap={20} tickLine={false} /><YAxis fontSize={10} allowDecimals={false} tickLine={false} axisLine={false} /><Tooltip />
      {series.map(([k, n, c]) => <Area key={k} dataKey={k} name={n} stroke={c} fill={c} fillOpacity={k === 'devices' ? 0.12 : 0.25} />)}
    </AreaChart></ResponsiveContainer>
  );
}
