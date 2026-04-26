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
      grid: { vertLines: { color: '#2d3748', style: LineStyle.Dotted }, horzLines: { color: '#2d3748', style: LineStyle.Dotted } },
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
    
    const ma20Data = data.map(d => ({ time: d.date, value: d.ma20 })).filter(d => d.value);
    const bbUpData = data.map(d => ({ time: d.date, value: d.bb_upper })).filter(d => d.value);
    const bbDownData = data.map(d => ({ time: d.date, value: d.bb_lower })).filter(d => d.value);

    // 🟡 볼린저 밴드 상단/하단
    const bbUpperSeries = chart.addLineSeries({ color: '#facc15', lineWidth: 1, lineStyle: LineStyle.Solid });
    bbUpperSeries.setData(bbUpData);
    
    const bbLowerSeries = chart.addLineSeries({ color: '#facc15', lineWidth: 1, lineStyle: LineStyle.Solid });
    bbLowerSeries.setData(bbDownData);

    // 🟢 20일 이동평균선
    const maSeries = chart.addLineSeries({ color: '#4ade80', lineWidth: 1, lineStyle: LineStyle.Solid });
    maSeries.setData(ma20Data);

    // 🔴 🔵 캔들 차트
    const mainSeries = chart.addCandlestickSeries({
      upColor: '#ef4444',       
      downColor: '#3b82f6',     
      borderVisible: false,
      wickUpColor: '#ef4444',   
      wickDownColor: '#3b82f6', 
    });
    mainSeries.setData(candleData);

    // 🎯 현재가 점선
    if (data.length > 0) {
      const currentPrice = data[data.length - 1].close;
      mainSeries.createPriceLine({
        price: currentPrice,
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: false, 
        title: '', 
      });
    }
    
    // 🏷️ 매매 마커 및 목표가 마커 표시
    let markers: any[] = [];
    
    // 1. 기존 매매 내역 마커 세팅
    if (tradeHistory && tradeHistory.length > 0) {
      markers = tradeHistory.map((t: any) => {
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
    }

    // 2. 보유 중일 경우 '오늘 캔들'에만 목표가 마커 추가
    const lastTrade = tradeHistory && tradeHistory.length > 0 ? tradeHistory[tradeHistory.length - 1] : null;
    const isHolding = lastTrade && lastTrade.type.includes("매수");

    if (isHolding && data.length > 0) {
      let totalQty = 0;
      let totalCost = 0;
      
      // 평단가 역산
      for (let i = tradeHistory.length - 1; i >= 0; i--) {
        const t = tradeHistory[i];
        if (t.type.includes("매도")) break;
        if (t.type.includes("매수")) {
          totalQty += t.qty;
          totalCost += (t.price * t.qty);
        }
      }
      
      const avgPrice = totalQty > 0 ? totalCost / totalQty : 0;
      const lastData = data[data.length - 1]; // 오늘 데이터
      
      if (lastData.ma20 && lastData.bb_upper && avgPrice > 0) {
        // 목표가 조건 비교
        const targetMid = (lastData.ma20 + lastData.bb_upper) / 2;
        const targetTp = avgPrice * 1.03;
        
        const finalTargetPrice = Math.min(targetMid, targetTp);
        const labelTitle = finalTargetPrice === targetTp ? '🎯목표(3%)' : '🎯목표(BB)';
        const priceStr = Math.floor(finalTargetPrice).toLocaleString();

        // 마지막 캔들 위에 보라색 원형 마커 추가
        markers.push({
          time: lastData.date,
          position: 'aboveBar',
          color: '#a855f7', 
          shape: 'circle',
          text: `${labelTitle}: ${priceStr}원`,
          size: 1,
        });
      }
    }

    // 3. 마커 시간순 정렬 후 차트에 적용
    if (markers.length > 0) {
      markers.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      mainSeries.setMarkers(markers);
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
