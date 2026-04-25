"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";

export default function TimelinePage() {
  const router = useRouter();
  const [simData, setSimData] = useState<any>(null);
  const [selectedYear, setSelectedYear] = useState<string>("전체");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [showTopBtn, setShowTopBtn] = useState(false);
  
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

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 300) {
        setShowTopBtn(true);
      } else {
        setShowTopBtn(false);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goToDetail = (ticker: string) => {
    const savedResult = sessionStorage.getItem('backtestResult');
    if (savedResult) {
      const result = JSON.parse(savedResult);
      const allStocks = [
        ...(result.holding_list || []), 
        ...(result.profit_list || []), 
        ...(result.loss_list || []), 
        ...(result.waiting_list || [])
      ];
      const stockDetail = allStocks.find((s: any) => s.ticker === ticker);
      
      if (stockDetail) {
        sessionStorage.setItem('currentStockDetail', JSON.stringify(stockDetail));
        router.push(`/stock/${ticker}`);
      } else {
        alert("종목 상세 정보를 찾을 수 없습니다.");
      }
    } else {
      alert("백테스트 결과 데이터가 없습니다. 메인 화면에서 다시 분석해주세요.");
      router.push('/');
    }
  };

  const availableYears = useMemo(() => {
    if (!simData || !simData.executed_trades) return [];
    const years = new Set(simData.executed_trades.map((t: any) => t.date.substring(0, 4)));
    return ["전체", ...Array.from(years).sort()];
  }, [simData]);

  const enrichedTrades = useMemo(() => {
    if (!simData || !simData.executed_trades) return [];
    
    let portfolio: Record<string, { qty: number, invested: number }> = {};
    
    return simData.executed_trades.map((trade: any) => {
      const isBuy = trade.type.includes("매수");
      const t = { ...trade };
      
      if (!portfolio[t.ticker]) {
        portfolio[t.ticker] = { qty: 0, invested: 0 };
      }
      
      const tradeAmount = t.price * t.qty;
      
      if (isBuy) {
        portfolio[t.ticker].qty += t.qty;
        portfolio[t.ticker].invested += tradeAmount;
        
        t.currentAvgPrice = portfolio[t.ticker].invested / portfolio[t.ticker].qty;
        t.totalInvested = portfolio[t.ticker].invested;
        t.totalQty = portfolio[t.ticker].qty;
        t.tradeAmount = tradeAmount; 
      } else {
        t.currentAvgPrice = portfolio[t.ticker].qty > 0 ? portfolio[t.ticker].invested / portfolio[t.ticker].qty : 0;
        t.totalInvested = portfolio[t.ticker].invested; 
        t.totalQty = portfolio[t.ticker].qty;
        t.tradeAmount = tradeAmount; 
        
        portfolio[t.ticker] = { qty: 0, invested: 0 };
      }
      return t;
    });
  }, [simData]);

  // 👇 [추가] 최대 동시 투자금(필요 시드) 계산 로직
  const maxRequiredSeed = useMemo(() => {
    if (!enrichedTrades || enrichedTrades.length === 0) return 0;
    
    let currentInvested = 0;
    let maxInvested = 0;
    
    // 시간순으로 정렬된 상태에서 매수/매도에 따른 누적 투자원금을 추적합니다.
    enrichedTrades.forEach((t: any) => {
      if (t.type.includes("매수")) {
        currentInvested += t.tradeAmount; // 매수 시 투자금 증가
      } else {
        currentInvested -= t.totalInvested; // 매도 시 해당 종목에 들어갔던 원금 회수
      }
      if (currentInvested > maxInvested) {
        maxInvested = currentInvested;
      }
    });
    
    return maxInvested;
  }, [enrichedTrades]);

  const filteredTrades = useMemo(() => {
    let result = enrichedTrades;
    if (selectedYear !== "전체") {
      result = result.filter((t: any) => t.date.startsWith(selectedYear));
    }
    if (selectedTicker) {
      result = result.filter((t: any) => t.ticker === selectedTicker);
    }
    return result;
  }, [enrichedTrades, selectedYear, selectedTicker]);

  const sortedTrades = useMemo(() => {
    if (sortOrder === "asc") return filteredTrades;
    return [...filteredTrades].reverse();
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

    chart.subscribeClick((param) => {
      if (param.time) {
        const dateStr = param.time as string;
        
        if (sortOrder === "desc") {
          setSortOrder("asc");
        }
        
        setTimeout(() => {
          const element = document.querySelector(`[data-date="${dateStr}"]`);
          if (element) {
            const y = element.getBoundingClientRect().top + window.scrollY - 140;
            window.scrollTo({ top: y, behavior: 'smooth' });
            
            const innerCard = element.querySelector('.trade-card');
            if (innerCard) {
              innerCard.classList.add('ring-4', 'ring-emerald-500', 'bg-gray-700');
              setTimeout(() => {
                innerCard.classList.remove('ring-4', 'ring-emerald-500', 'bg-gray-700');
              }, 2000);
            }
          }
        }, 100);
      }
    });

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
  }, [filteredEquityCurve, sortOrder]);

  const handleTickerToggle = (ticker: string) => {
    if (selectedTicker === ticker) {
      setSelectedTicker(null); 
    } else {
      setSelectedTicker(ticker); 
    }
  };

  if (!simData) return <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">데이터를 불러오는 중...</div>;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans md:font-mono text-sm pb-20 relative">
      <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur border-b border-gray-800 p-4 shadow-lg flex flex-col gap-3">
        <div className="flex items-center justify-between">
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
          {selectedTicker && (
            <button 
              onClick={() => setSelectedTicker(null)}
              className="bg-blue-600/20 text-blue-400 border border-blue-500/50 px-3 py-1 rounded-full text-xs font-bold hover:bg-blue-600/40 transition-colors"
            >
              {selectedTicker} 필터 해제 ✖
            </button>
          )}
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
              <h2 className="text-lg font-bold text-gray-300 mb-1 flex items-center gap-2">
                📈 {selectedYear === "전체" ? "전체" : `${selectedYear}년`} 실현 자산 성장 그래프
              </h2>
              <div className="text-xs text-gray-500">
                {selectedTicker ? "※ 차트는 계좌 전체의 자산 흐름을 보여줍니다." : "💡 차트의 특정 날짜를 클릭하면 해당 일자의 매매 내역으로 이동합니다."}
              </div>
            </div>
            {selectedYear === "전체" && (
              <div className="flex gap-6 text-right">
                {/* 👇 [추가] 최대 필요 시드 표시 영역 */}
                <div className="bg-gray-900/50 px-4 py-2 rounded-xl border border-gray-700/50">
                  <div className="text-xs text-gray-400 mb-1">최대 필요 시드 (Peak)</div>
                  <div className="text-xl font-bold text-blue-400">{parseInt(maxRequiredSeed.toString()).toLocaleString()}원</div>
                </div>
                <div className="bg-gray-900/50 px-4 py-2 rounded-xl border border-gray-700/50">
                  <div className="text-xs text-gray-400 mb-1">최종 자산</div>
                  <div className="text-xl font-bold text-emerald-400">{parseInt(simData.final_asset).toLocaleString()}원</div>
                </div>
              </div>
            )}
          </div>
          
          {filteredEquityCurve && filteredEquityCurve.length > 0 ? (
            <div ref={chartContainerRef} className="w-full h-[300px] relative cursor-pointer" />
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
              {sortedTrades.map((trade: any, idx: number) => {
                const isBuy = trade.type.includes("매수");
                const isProfit = trade.realizedProfit > 0;
                const previousCash = isBuy ? trade.cash + trade.tradeAmount : trade.cash - trade.tradeAmount;
                const isChecked = selectedTicker === trade.ticker;
                
                return (
                  <div key={idx} data-date={trade.date} className={`relative pl-6 transition-opacity duration-300 ${selectedTicker && !isChecked ? 'opacity-30' : 'opacity-100'}`}>
                    <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-4 border-gray-900 ${isBuy ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                    
                    <div className={`trade-card bg-gray-800/60 p-5 rounded-xl border transition-all duration-500 shadow-sm ${isChecked ? 'border-blue-500 ring-1 ring-blue-500/50' : 'border-gray-700 hover:bg-gray-700'}`}>
                      
                      <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4 mb-4 border-b border-gray-700/50 pb-4">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`text-xs font-bold px-2 py-1 rounded ${isBuy ? 'bg-red-900/50 text-red-400' : 'bg-blue-900/50 text-blue-400'}`}>
                              {trade.type}
                            </span>
                            <span className="text-sm font-bold text-gray-300">{trade.date}</span>
                          </div>
                          
                          <div className="flex items-center gap-3 mt-1">
                            <input 
                              type="checkbox" 
                              checked={isChecked}
                              onChange={() => handleTickerToggle(trade.ticker)}
                              className="w-4 h-4 rounded border-gray-500 text-blue-500 focus:ring-blue-500 bg-gray-900 cursor-pointer"
                              title="이 종목만 모아보기"
                            />
                            <div 
                              className="text-lg font-bold text-gray-100 cursor-pointer hover:text-blue-400 transition-colors"
                              onClick={() => handleTickerToggle(trade.ticker)}
                            >
                              {trade.stockName} <span className="text-sm font-normal text-gray-500">{trade.ticker}</span>
                            </div>
                            
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                goToDetail(trade.ticker);
                              }}
                              className="ml-2 text-xs bg-gray-700 hover:bg-blue-600 text-gray-300 hover:text-white px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 shadow-sm"
                            >
                              <span>🔍</span> 상세 차트 보기
                            </button>
                          </div>
                          <div className="text-sm text-gray-400 mt-1 ml-7">{trade.detail}</div>
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

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 bg-gray-900/40 p-3 rounded-lg border border-gray-700/50">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">{isBuy ? '이번 체결액' : '총 매도액'}</div>
                          <div className={`font-bold ${isBuy ? 'text-red-400' : 'text-blue-400'}`}>{parseInt(trade.tradeAmount).toLocaleString()}원</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">{isBuy ? '누적 매수원금' : '기존 매수원금'}</div>
                          <div className="font-bold text-gray-200">{parseInt(trade.totalInvested).toLocaleString()}원</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">{isBuy ? '현재 평단가' : '기존 평단가'}</div>
                          <div className="font-bold text-gray-200">{parseInt(trade.currentAvgPrice).toLocaleString()}원</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">{isBuy ? '총 보유 수량' : '매도 수량'}</div>
                          <div className="font-bold text-gray-200">{trade.totalQty}주</div>
                        </div>
                      </div>
                      
                      <div className="bg-gray-900/80 rounded-lg p-3 text-xs font-mono">
                        <div className="flex justify-between items-center text-gray-500 mb-1">
                          <span>거래 전 현금 잔고</span>
                          <span>{parseInt(previousCash.toString()).toLocaleString()}원</span>
                        </div>
                        <div className={`flex justify-between items-center font-bold mb-2 pb-2 border-b border-gray-700/50 ${isBuy ? 'text-red-400' : 'text-blue-400'}`}>
                          <span>{isBuy ? '출금 (계좌에서 빠짐)' : '입금 (계좌로 들어옴)'}</span>
                          <span>{isBuy ? '-' : '+'}{parseInt(trade.tradeAmount.toString()).toLocaleString()}원</span>
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

      <button
        onClick={scrollToTop}
        className={`fixed bottom-8 right-8 p-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full shadow-2xl transition-all duration-300 z-50 flex items-center justify-center ${
          showTopBtn ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10 pointer-events-none"
        }`}
        title="맨 위로 이동"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
      </button>
    </div>
  );
}
