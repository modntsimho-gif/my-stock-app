"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";

export default function TimelinePage() {
  const router = useRouter();
  const [simData, setSimData] = useState<any>(null);
  const [selectedYear, setSelectedYear] = useState<string>("전체");
  
  // 👇 [추가] 정렬 상태 관리 (기본값: 과거순)
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);

  useEffect(() => {
    const savedSim = sessionStorage.getItem('accountSimResult');
    if (savedSim) {
      setSimData(JSON.parse(savedSim));
    } else {
      router.push('/');
    }
  }, [router]);

  const availableYears = useMemo(() => {
    if (!simData || !simData.executed_trades) return [];
    const years = new Set(simData.executed_trades.map((t: any) => t.date.substring(0, 4)));
    return ["전체", ...Array.from(years).sort()];
  }, [simData]);

  const filteredTrades = useMemo(() => {
    if (!simData || !simData.executed_trades) return [];
    if (selectedYear === "전체") return simData.executed_trades;
    return simData.executed_trades.filter((t: any) => t.date.startsWith(selectedYear));
  }, [simData, selectedYear]);

  // 👇 [추가] 필터링된 내역을 정렬 상태에 따라 뒤집어주는 로직
  const sortedTrades = useMemo(() => {
    if (sortOrder === "asc") return filteredTrades;
    return [...filteredTrades].reverse(); // 최신순일 경우 배열을 뒤집음
  }, [filteredTrades, sortOrder]);

  const filteredEquityCurve = useMemo(() => {
    if (!simData || !simData.equity_curve) return [];
    if (selectedYear === "전체") return simData.equity_curve;
    return simData.equity_curve.filter((d: any) => d.time.startsWith(selectedYear));
  }, [simData, selectedYear]);

  useEffect(() => {
    if (!filteredEquityCurve || filteredEquityCurve.length === 0 || !chartContainerRef.current) {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      return;
    }

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

    const areaSeries = chart.addAreaSeries({
      lineColor: '#10b981', 
      topColor: 'rgba(16, 185, 129, 0.4)',
      bottomColor: 'rgba(16, 185, 129, 0.0)',
      lineWidth: 2,
    });

    areaSeries.setData(filteredEquityCurve);
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
  }, [filteredEquityCurve]);

  if (!simData) return <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">데이터를 불러오는 중...</div>;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans md:font-mono text-sm pb-20">
      <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur border-b border-gray-800 p-4 shadow-lg flex flex-col gap-3">
        <div className="flex items-center gap-4">
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
        
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {availableYears.map(year => (
            <button
              key={year as string}
              onClick={() => setSelectedYear(year as string)}
              className={`px-4 py-1.5 rounded-full text-sm font-bold whitespace-nowrap transition-colors border ${
                selectedYear === year
                  ? "bg-emerald-600 text-white border-emerald-500 shadow-md"
                  : "bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700"
              }`}
            >
              {year === "전체" ? "전체 기간" : `${year}년`}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-8 mt-4">
        <section className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700 shadow-lg">
          <div className="flex justify-between items-end mb-4">
            <div>
              <h2 className="text-lg font-bold text-gray-300 mb-1">
                📈 {selectedYear === "전체" ? "전체" : `${selectedYear}년`} 실현 자산 성장 그래프
              </h2>
              <div className="text-xs text-gray-500">매도(익절/손절) 시점마다 확정된 내 계좌의 자산 흐름입니다.</div>
            </div>
            {selectedYear === "전체" && (
              <div className="text-right">
                <div className="text-xs text-gray-500">최종 자산</div>
                <div className="text-2xl font-bold text-emerald-400">{parseInt(simData.final_asset).toLocaleString()}원</div>
              </div>
            )}
          </div>
          
          {filteredEquityCurve && filteredEquityCurve.length > 0 ? (
            <div ref={chartContainerRef} className="w-full h-[300px] relative" />
          ) : (
            <div className="h-[300px] flex items-center justify-center border border-dashed border-gray-700 rounded-xl text-gray-500 bg-gray-900/30">
              해당 기간에 실현 손익(매도)이 발생한 데이터가 없습니다.
            </div>
          )}
        </section>

        <section className="bg-gray-800/30 p-6 rounded-2xl border border-gray-700 shadow-lg">
          <div className="flex justify-between items-center mb-6 border-b border-gray-700 pb-2">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-gray-300">상세 체결 내역</h2>
              <span className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded-lg font-bold">{filteredTrades.length}건</span>
            </div>
            
            {/* 👇 [추가] 정렬 토글 버튼 */}
            <button 
              onClick={() => setSortOrder(prev => prev === "asc" ? "desc" : "asc")}
              className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 shadow-sm"
            >
              {sortOrder === "asc" ? "🔽 과거순 (기본)" : "🔼 최신순"}
            </button>
          </div>
          
          {sortedTrades.length === 0 ? (
            <div className="text-center text-gray-500 py-20 border border-dashed border-gray-700 rounded-xl">체결된 매매 내역이 없습니다.</div>
          ) : (
            <div className="relative border-l-2 border-gray-700 ml-4 space-y-8">
              {/* 👇 [수정] filteredTrades 대신 정렬된 sortedTrades를 매핑합니다 */}
              {sortedTrades.map((trade: any, idx: number) => {
                const isBuy = trade.type.includes("매수");
                const isProfit = trade.realizedProfit > 0;
                
                const tradeAmount = trade.price * trade.qty;
                const previousCash = isBuy ? trade.cash + tradeAmount : trade.cash - tradeAmount;
                
                return (
                  <div key={idx} className="relative pl-6">
                    <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-4 border-gray-900 ${isBuy ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                    
                    <div className="bg-gray-800/60 p-5 rounded-xl border border-gray-700 hover:bg-gray-700 transition-all shadow-sm">
                      
                      <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4 mb-4 border-b border-gray-700/50 pb-4">
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
                        
                        <div className="text-left md:text-right">
                          <div className="text-xs text-gray-500 mb-1">체결 단가 및 수량</div>
                          <div className="font-bold text-gray-100">{trade.price.toLocaleString()}원 <span className="text-gray-500 font-normal">× {trade.qty}주</span></div>
                          
                          {!isBuy && trade.realizedProfit !== undefined && (
                            <div className="mt-2 pt-2 border-t border-gray-700/50">
                              <span className="text-xs text-gray-500 mr-2">실현 손익:</span>
                              <span className={`font-bold ${isProfit ? 'text-red-400' : 'text-blue-400'}`}>
                                {isProfit ? '+' : ''}{parseInt(trade.realizedProfit).toLocaleString()}원
                                <span className="text-xs ml-1 opacity-80">({trade.profitRate.toFixed(2)}%)</span>
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="bg-gray-900/50 rounded-lg p-3 text-xs font-mono">
                        <div className="flex justify-between items-center text-gray-500 mb-1">
                          <span>거래 전 현금 잔고</span>
                          <span>{parseInt(previousCash.toString()).toLocaleString()}원</span>
                        </div>
                        <div className={`flex justify-between items-center font-bold mb-2 pb-2 border-b border-gray-700/50 ${isBuy ? 'text-red-400' : 'text-blue-400'}`}>
                          <span>{isBuy ? '출금 (매수 금액)' : '입금 (매도 금액)'}</span>
                          <span>{isBuy ? '-' : '+'}{parseInt(tradeAmount.toString()).toLocaleString()}원</span>
                        </div>
                        <div className="flex justify-between items-center text-gray-300 font-bold text-sm">
                          <span>거래 후 현금 잔고</span>
                          <span>{parseInt(trade.cash).toLocaleString()}원</span>
                        </div>
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
