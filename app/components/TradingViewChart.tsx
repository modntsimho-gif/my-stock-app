"use client";
import { useState, useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode, LineStyle } from "lightweight-charts";

export default function TradingViewChart({ data, tradeHistory }: { data: any[], tradeHistory: any[] }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => { setIsMounted(true); }, []);

  useEffect(() => {
    if (!isMounted || !chartContainerRef.current || data.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#9ca3af' },
      grid: { vertLines: { color: '#374151', style: LineStyle.Dotted }, horzLines: { color: '#374151', style: LineStyle.Dotted } },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight || 400,
      rightPriceScale: { borderColor: '#374151', scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: '#374151', timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    });

    chartRef.current = chart;

    const lineData = data.map(d => ({ time: d.date, value: d.close }));
    const ma20Data = data.map(d => ({ time: d.date, value: d.ma20 })).filter(d => d.value);
    const bbUpData = data.map(d => ({ time: d.date, value: d.bb_upper })).filter(d => d.value);
    const bbDownData = data.map(d => ({ time: d.date, value: d.bb_lower })).filter(d => d.value);

    // 👇 [디자인 수정] 볼린저 밴드 상단 (쨍한 빨간색, 굵기 2)
    const bbUpperSeries = chart.addLineSeries({ 
        color: 'rgba(255, 82, 82, 0.9)', 
        lineWidth: 2, 
        lineStyle: LineStyle.Dashed 
      });
      bbUpperSeries.setData(bbUpData);
      
      // 👇 [디자인 수정] 볼린저 밴드 하단 (쨍한 파란색, 굵기 2)
      const bbLowerSeries = chart.addLineSeries({ 
        color: 'rgba(33, 150, 243, 0.9)', 
        lineWidth: 2, 
        lineStyle: LineStyle.Dashed 
      });
      bbLowerSeries.setData(bbDownData);
  
      // 👇 [디자인 수정] 20일 이동평균선 (쨍한 노란색, 굵기 2)
      const maSeries = chart.addLineSeries({ 
        color: '#ffeb3b', 
        lineWidth: 2 
      });
      maSeries.setData(ma20Data);
  
      // 캔들(영역) 차트 디자인 (기존 유지)
      const mainSeries = chart.addAreaSeries({
        topColor: 'rgba(34, 197, 94, 0.56)', bottomColor: 'rgba(34, 197, 94, 0.04)', lineColor: '#4ade80', lineWidth: 2,
      });
      mainSeries.setData(lineData);
    
    if (tradeHistory && tradeHistory.length > 0) {
      const markers = tradeHistory.map((t: any) => ({
        time: t.date,
        position: t.type.includes("매수") ? 'belowBar' : 'aboveBar',
        color: t.type.includes("매수") ? '#ef4444' : '#3b82f6',
        shape: t.type.includes("매수") ? 'arrowUp' : 'arrowDown',
        text: t.type.includes("매수") ? 'B' : 'S',
        size: 1,
      }));
      mainSeries.setMarkers(markers as any[]);
    }

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
      const newRect = entries[0].contentRect;
      if (newRect.width === 0 || newRect.height === 0) return;
      chart.applyOptions({ width: newRect.width, height: newRect.height });
      try { chart.timeScale().fitContent(); } catch(e) {}
    });
    resizeObserver.observe(chartContainerRef.current);

    if(data.length > 60) {
        try { chart.timeScale().setVisibleRange({ from: data[data.length - 60].date, to: data[data.length - 1].date }); } 
        catch(e) { chart.timeScale().fitContent(); }
    } else { chart.timeScale().fitContent(); }

    return () => {
      resizeObserver.disconnect();
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
    };
  }, [data, tradeHistory, isMounted]);

  if (!isMounted) return <div className="w-full h-full bg-gray-900/50 animate-pulse rounded-lg" />;
  return <div ref={chartContainerRef} className="w-full h-full relative" />;
}
