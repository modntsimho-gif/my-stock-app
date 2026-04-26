"use client";
import { useState, useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode, LineStyle } from "lightweight-charts";

export default function TradingViewChart({ data, tradeHistory, focusDate }: { data: any[], tradeHistory: any[], focusDate?: string | null }) {
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

    const candleData = data.map(d => ({ 
      time: d.date, 
      open: d.open, 
      high: d.high, 
      low: d.low, 
      close: d.close 
    }));
    
    // 볼린저 밴드 및 MA 데이터
    const ma20Data = data.map(d => ({ time: d.date, value: d.ma20 })).filter(d => d.value);
    const bbUpData = data.map(d => ({ time: d.date, value: d.bb_upper })).filter(d => d.value);
    const bbDownData = data.map(d => ({ time: d.date, value: d.bb_lower })).filter(d => d.value);

    // 👇 일목균형표 구름대(선행스팬1, 2) 데이터 추출
    const senkou1Data = data.map(d => ({ time: d.date, value: d.senkou_span1 })).filter(d => d.value !== null && d.value !== undefined);
    const senkou2Data = data.map(d => ({ time: d.date, value: d.senkou_span2 })).filter(d => d.value !== null && d.value !== undefined);

    // 👇 선행스팬1 그리기 (초록색 계열)
    const senkou1Series = chart.addLineSeries({ 
      color: 'rgba(16, 185, 129, 0.6)', 
      lineWidth: 1, 
      lineStyle: LineStyle.Solid,
      title: '선행스팬1'
    });
    senkou1Series.setData(senkou1Data);

    // 👇 선행스팬2 그리기 (주황/빨강 계열)
    const senkou2Series = chart.addLineSeries({ 
      color: 'rgba(249, 115, 22, 0.6)', 
      lineWidth: 1, 
      lineStyle: LineStyle.Solid,
      title: '선행스팬2'
    });
    senkou2Series.setData(senkou2Data);

    // 볼린저 밴드 그리기
    const bbUpperSeries = chart.addLineSeries({ color: 'rgba(255, 82, 82, 0.9)', lineWidth: 2, lineStyle: LineStyle.Dashed });
    bbUpperSeries.setData(bbUpData);
    
    const bbLowerSeries = chart.addLineSeries({ color: 'rgba(33, 150, 243, 0.9)', lineWidth: 2, lineStyle: LineStyle.Dashed });
    bbLowerSeries.setData(bbDownData);

    const maSeries = chart.addLineSeries({ color: '#ffeb3b', lineWidth: 2 });
    maSeries.setData(ma20Data);

    // 캔들스틱 그리기
    const mainSeries = chart.addCandlestickSeries({
      upColor: '#ef4444',       
      downColor: '#3b82f6',     
      borderVisible: false,
      wickUpColor: '#ef4444',   
      wickDownColor: '#3b82f6', 
    });
    mainSeries.setData(candleData);

    // 현재가 표시
    if (data.length > 0) {
      const currentPrice = data[data.length - 1].close;
      mainSeries.createPriceLine({
        price: currentPrice,
        color: '#10b981',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '현재가',
      });
    }
    
    // 매매 마커 표시
    if (tradeHistory && tradeHistory.length > 0) {
      const markers = tradeHistory.map((t: any) => {
        const isBuy = t.type.includes("매수");
        const priceStr = parseInt(t.price).toLocaleString();
        return {
          time: t.date,
          position: isBuy ? 'belowBar' : 'aboveBar',
          color: isBuy ? '#ef4444' : '#3b82f6',
          shape: isBuy ? 'arrowUp' : 'arrowDown',
          text: isBuy ? `B: ${priceStr}` : `S: ${priceStr}`,
          size: 1,
        };
      });
      mainSeries.setMarkers(markers as any[]);
    }

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
      const newRect = entries[0].contentRect;
      if (newRect.width === 0 || newRect.height === 0) return;
      chart.applyOptions({ width: newRect.width, height: newRect.height });
    });
    resizeObserver.observe(chartContainerRef.current);

    setTimeout(() => {
      if(data.length > 30) {
          try { chart.timeScale().setVisibleRange({ from: data[data.length - 30].date, to: data[data.length - 1].date }); } 
          catch(e) { console.error("줌인 에러:", e); }
      } else { 
          chart.timeScale().fitContent(); 
      }
    }, 50);

    return () => {
      resizeObserver.disconnect();
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
    };
  }, [data, tradeHistory, isMounted]);

  useEffect(() => {
    if (!chartRef.current || !focusDate || data.length === 0) return;
    
    const targetIndex = data.findIndex(d => d.date === focusDate);
    if (targetIndex !== -1) {
      const fromIndex = Math.max(0, targetIndex - 15);
      const toIndex = Math.min(data.length - 1, targetIndex + 15);
      
      try {
        chartRef.current.timeScale().setVisibleRange({
          from: data[fromIndex].date,
          to: data[toIndex].date,
        });
      } catch (e) {
        console.error("차트 이동 에러:", e);
      }
    }
  }, [focusDate, data]);

  if (!isMounted) return <div className="w-full h-full bg-gray-900/50 animate-pulse rounded-lg" />;
  return <div ref={chartContainerRef} className="w-full h-full relative" />;
}
