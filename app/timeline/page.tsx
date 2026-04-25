"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";

export default function TimelinePage() {
  const router = useRouter();
  const [simData, setSimData] = useState<any>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);

  useEffect(() => {
    const savedSim = sessionStorage.getItem('accountSimResult');
    if (savedSim) {
      setSimData(JSON.parse(savedSim));
    } else {
      // 데이터가 없으면 홈으로 돌려보냄
      router.push('/');
    }
  }, [router]);

  // 차트 그리기 로직
  useEffect(() => {
    if (!simData || !simData.equity_curve || simData.equity_curve.length === 0 || !chartContainerRef.current) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#9ca3af' },
      grid: { vertLines: { color: '#374151' }, horzLines: { color: '#374151' } },
      width: chartContainerRef.current.clientWidth,
      height: 300,
      rightPriceScale: { borderColor: '#374151' },
      timeScale: { borderColor: '#374151', timeVisible: true },
      crosshair: { mode: CrosshairMode.Normal },
    });

    chartRef.current = chart;

    // 실현 자산 성장 그래프 (Area Series)
    const areaSeries = chart.addAreaSeries({
      lineColor: '#10b981', // 에메랄드 그린
      topColor: 'rgba(16, 185, 129, 0.4)',
      bottomColor: 'rgba(16, 185, 129, 0.0)',
      lineWidth: 2,
    });

    areaSeries.setData(simData.equity_curve);
    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
      const newRect = entries[0].contentRect;
      chart.applyOptions({ width: newRect.width });
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
    };
  }, [simData]);

  if (!simData) return <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">데이터를 불러오는 중...</div>;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans md:font-mono text-sm pb-20">
      {/* 헤더 */}
      <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur border-b border-gray-800 p-4 shadow-lg flex items-center gap-4">
        <button 
          onClick={() => router.back()}
          className="text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded transition-colors flex items-center gap-1"
        >
          <span>←</span> 뒤로
        </button>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <span>📜</span> 전체 매매 타임라인
        </h1>
      </div>

      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-8 mt-4">
        
        {/* 1. 계좌 자산 성장 차트 (Equity Curve) */}
        <section className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700 shadow-lg">
          <div className="flex justify-between items-end mb-4">
            <div>
              <h2 className="text-lg font-bold text-gray-300 mb-1">📈 실현 자산 성장 그래프</h2>
              <div className="text-xs text-gray-500">매도(익절/손절) 시점마다 확정된 내 계좌의 자산 흐름입니다.</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500">최종 자산</div>
              <div className="text-2xl font-bold text-emerald-400">{parseInt(simData.final_asset).toLocaleString()}원</div>
            </div>
          </div>
          
          {simData.equity_curve && simData.equity_curve.length > 0 ? (
            <div ref={chartContainerRef} className="w-full h-[300px] relative" />
          ) : (
            <div className="h-[300px] flex items-center justify-center border border-dashed border-gray-700 rounded-xl text-gray-500">
              차트를 그릴 매매 데이터가 부족합니다.
            </div>
          )}
        </section>

        {/* 2. 상세 매매 내역 리스트 */}
        <section className="bg-gray-800/30 p-6 rounded-2xl border border-gray-700 shadow-lg">
          <h2 className="text-lg font-bold text-gray-300 mb-6 border-b border-gray-700 pb-2">상세 체결 내역</h2>
          
          {simData.executed_trades.length === 0 ? (
            <div className="text-center text-gray-500 py-20 border border-dashed border-gray-700 rounded-xl">체결된 매매 내역이 없습니다.</div>
          ) : (
            <div className="relative border-l-2 border-gray-700 ml-4 space-y-8">
              {simData.executed_trades.map((trade: any, idx: number) => {
                const isBuy = trade.type.includes("매수");
                const isProfit = trade.realizedProfit > 0;
                
                return (
                  <div key={idx} className="relative pl-6">
                    <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-4 border-gray-900 ${isBuy ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                    
                    <div className="bg-gray-800/60 p-5 rounded-xl border border-gray-700 hover:bg-gray-700 transition-all shadow-sm">
                      <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`text-xs font-bold px-2 py-1 rounded ${isBuy ? 'bg-red-900/50 text-red-400' : 'bg-blue-900/50 text-blue-400'}`}>
                              {trade.type}
                            </span>
                            <span className="text-sm font-bold text-gray-300">{trade.date}</span>
                          </div>
                          <div className="text-lg font-bold text-gray-100">{trade.stockName} <span className="text-sm font-normal text-gray-500">{trade.ticker}</span></div>
                          <div className="text-sm text-gray-400 mt-1">{trade.detail}</div>
                        </div>
                        
                        <div className="text-left md:text-right bg-gray-900/50 p-3 rounded-lg border border-gray-700 min-w-[200px]">
                          <div className="flex justify-between md:block mb-1">
                            <span className="text-xs text-gray-500 md:hidden">체결가:</span>
                            <span className="font-bold text-gray-100">{trade.price.toLocaleString()}원 <span className="text-xs text-gray-500 font-normal">({trade.qty}주)</span></span>
                          </div>
                          
                          {!isBuy && trade.realizedProfit !== undefined && (
                            <div className="flex justify-between md:justify-end items-center gap-2 mt-2 pt-2 border-t border-gray-700">
                              <span className="text-xs text-gray-500">실현 손익:</span>
                              <span className={`font-bold ${isProfit ? 'text-red-400' : 'text-blue-400'}`}>
                                {isProfit ? '+' : ''}{parseInt(trade.realizedProfit).toLocaleString()}원
                                <span className="text-xs ml-1 opacity-80">({trade.profitRate.toFixed(2)}%)</span>
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="mt-4 pt-3 border-t border-gray-700/50 text-xs text-gray-500 flex justify-between">
                        <span>거래 후 남은 현금 잔고</span>
                        <span className="text-gray-300 font-bold">{parseInt(trade.cash).toLocaleString()}원</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
