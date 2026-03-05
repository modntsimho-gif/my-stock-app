"use client";
import { useState, useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode, LineStyle } from "lightweight-charts";

// ============================================================================
// ★ TradingView 차트 컴포넌트
// ============================================================================
const TradingViewChart = ({ data, tradeHistory }: { data: any[], tradeHistory: any[] }) => {
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

    const bbUpperSeries = chart.addLineSeries({ color: 'rgba(239, 68, 68, 0.5)', lineWidth: 1, lineStyle: LineStyle.Dashed });
    bbUpperSeries.setData(bbUpData);
    
    const bbLowerSeries = chart.addLineSeries({ color: 'rgba(59, 130, 246, 0.5)', lineWidth: 1, lineStyle: LineStyle.Dashed });
    bbLowerSeries.setData(bbDownData);

    const maSeries = chart.addLineSeries({ color: '#fbbf24', lineWidth: 1 });
    maSeries.setData(ma20Data);

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
};

// ============================================================================
// ★ 메인 페이지 컴포넌트
// ============================================================================
export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  
  const [selectedStock, setSelectedStock] = useState<any>(null);
  const [chartData, setChartData] = useState<any[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  // 오늘 날짜 구하기 (YYYY-MM-DD) - 한국 시간 기준
  const getTodayString = () => {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const koreaTimeDiff = 9 * 60 * 60 * 1000;
    const korNow = new Date(utc + koreaTimeDiff);
    return korNow.toISOString().split('T')[0];
  };

  const todayStr = getTodayString();

  useEffect(() => {
    if (selectedStock) {
      setChartLoading(true);
      fetch(`/api/chart?ticker=${selectedStock.ticker}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            const sorted = data.sort((a:any, b:any) => new Date(a.date).getTime() - new Date(b.date).getTime());
            setChartData(sorted);
          } else { setChartData([]); }
        })
        .catch((err) => { console.error("차트 로딩 실패", err); setChartData([]); })
        .finally(() => setChartLoading(false));
    } else { setChartData([]); }
  }, [selectedStock]);

  const runAnalysis = async (fileNum: number) => {
    setLoading(true); setResult(null); setLogs([]); setProgress({ current: 0, total: 0 });
    try {
      const response = await fetch(`/api/analyze?file=${fileNum}`);
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          try {
            const data = JSON.parse(trimmedLine);
            if (data.type === "start") {
              setProgress({ current: 0, total: data.total });
              setLogs((prev) => [...prev, `🚀 분석 시작... 총 ${data.total}개 종목`]);
            } else if (data.type === "progress") {
              setProgress({ current: data.current, total: data.total });
            } else if (data.type === "result") {
              setResult(data);
              setLogs((prev) => [...prev, "🏁 분석 완료!"]);
            } else if (data.type === "error") {
              setLogs((prev) => [...prev, `❌ 에러: ${data.message}`]);
            }
          } catch (e) { console.error("JSON 파싱 에러 (무시됨):", trimmedLine); }
        }
      }
    } catch (err) { alert("통신 중 에러 발생"); console.error(err); } finally { setLoading(false); }
  };

  // ★ 데이터 분류 로직 (날짜 필터링 강화)
  let todayBuys: any[] = [];
  let holdings: any[] = [];
  let todaySells: any[] = [];
  let pastSells: any[] = [];

  if (result) {
    // 1. 당일 매수: 보유 목록 중 매수일이 오늘인 것
    todayBuys = result.holding_list.filter((item: any) => item.first_buy_date === todayStr);
    
    // 2. 보유 중: 보유 목록 중 매수일이 오늘이 아닌 것
    holdings = result.holding_list.filter((item: any) => item.first_buy_date !== todayStr);
    
    // 3. 매도 리스트 전체 통합 (익절 + 손절)
    const allClosed = [...result.profit_list, ...result.loss_list];

    // 4. 당일 매도: 매도일(sell_date)이 오늘인 것만 필터링
    todaySells = allClosed.filter((item: any) => {
      // 우선순위 1: 명시적인 sell_date 확인
      if (item.sell_date) return item.sell_date === todayStr;
      
      // 우선순위 2: 거래 내역의 마지막 날짜(매도일) 확인
      if (item.trade_history && item.trade_history.length > 0) {
        const lastDate = item.trade_history[item.trade_history.length - 1].date;
        return lastDate === todayStr;
      }
      return false; // 날짜 정보 없으면 제외
    });

    // 5. 지난 매매 내역: 오늘 판 게 아닌 것들
    pastSells = allClosed.filter((item: any) => {
      if (item.sell_date) return item.sell_date !== todayStr;
      if (item.trade_history && item.trade_history.length > 0) {
        const lastDate = item.trade_history[item.trade_history.length - 1].date;
        return lastDate !== todayStr;
      }
      return true; // 날짜 정보 없으면 과거 내역으로 간주
    });
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans md:font-mono text-sm pb-10 relative">
      <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur border-b border-gray-800 p-4 shadow-lg">
        <h1 className="text-xl md:text-2xl font-bold text-green-400 mb-3 flex items-center gap-2">
          <span>📈</span> 가자 [반포자이]로 <span className="text-xs text-gray-500 font-normal mt-1">원베일리도 낫베드</span>
        </h1>
        <div>
          <div className="flex flex-col md:flex-row gap-2">
            <button onClick={() => runAnalysis(1)} disabled={loading} className={`flex-1 px-6 py-3 rounded-lg font-bold transition-all shadow-md ${loading ? "bg-gray-700 text-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-500 text-white active:scale-95"}`}>
              {loading ? `분석 중... (${progress.current}/${progress.total})` : "🚀 분석 (기본)"}
            </button>
            <button onClick={() => runAnalysis(2)} disabled={loading} className={`flex-1 px-6 py-3 rounded-lg font-bold transition-all shadow-md ${loading ? "bg-gray-700 text-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500 text-white active:scale-95"}`}>
              {loading ? "대기 중..." : "🧪 분석 (파일 2)"}
            </button>
          </div>
          {loading && progress.total > 0 && (
            <div className="w-full bg-gray-800 h-2 rounded-full mt-3 overflow-hidden">
              <div className="bg-green-500 h-full transition-all duration-300" style={{ width: `${(progress.current / progress.total) * 100}%` }}></div>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-8">
        {result && (
          <>
            {/* 1. 당일 매수 */}
            <section>
              <h2 className="text-lg md:text-xl font-bold text-white mb-3 flex items-center gap-2 border-b border-gray-700 pb-2">
                <span className="text-red-500">🚀 당일 매수 체결</span>
                <span className="bg-red-600 text-white text-[10px] px-2 py-0.5 rounded-full">NEW</span>
                <span className="text-xs text-gray-500 font-normal ml-auto">기준일: {todayStr}</span>
              </h2>
              {todayBuys.length === 0 ? (
                <div className="p-6 text-center bg-gray-800/30 rounded-lg text-gray-500 border border-gray-800 border-dashed">오늘 매수한 종목이 없습니다.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {todayBuys.map((item: any) => {
                     const rate = ((item.current_price - item.avg_price) / item.avg_price) * 100;
                     return (
                      <div key={item.ticker} onClick={() => setSelectedStock(item)} className="bg-gray-800 p-4 rounded-xl border-2 border-red-500/30 shadow-lg relative overflow-hidden cursor-pointer hover:bg-gray-750 hover:border-red-500 transition-all">
                        <div className="absolute top-0 right-0 bg-red-600 text-white text-[10px] px-2 py-1 rounded-bl-lg font-bold">Today Buy</div>
                        <div className="flex justify-between items-start mb-2 pl-1">
                          <div><div className="font-bold text-base text-gray-100">{item.stock_name}</div><div className="text-xs text-gray-500">{item.ticker}</div></div>
                          <div className={`text-lg font-bold ${rate > 0 ? "text-red-400" : "text-blue-400"}`}>{rate > 0 ? "+" : ""}{rate.toFixed(2)}%</div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-gray-400 bg-gray-900/30 p-2 rounded">
                          <div>평단: <span className="text-gray-200">{parseInt(item.avg_price).toLocaleString()}</span></div>
                          <div>현재: <span className="text-gray-200">{item.current_price.toLocaleString()}</span></div>
                        </div>
                      </div>
                     )
                  })}
                </div>
              )}
            </section>

            {/* 2. 당일 매도 (필터링 적용됨) */}
            <section>
              <h2 className="text-lg md:text-xl font-bold text-white mb-3 flex items-center gap-2 border-b border-gray-700 pb-2">
                <span className="text-blue-400">💸 당일 매도 체결</span>
                <span className="bg-blue-900/50 text-blue-300 text-xs px-2 py-0.5 rounded-full">{todaySells.length}건</span>
              </h2>
              {todaySells.length === 0 ? (
                <div className="p-6 text-center bg-gray-800/30 rounded-lg text-gray-500 border border-gray-800 border-dashed">오늘 매도한 종목이 없습니다.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {todaySells.map((item: any) => {
                    const isProfit = item.return_rate > 0;
                    const netProfit = item.final_asset ? item.final_asset - 10000000 : 0;
                    return (
                      <div key={item.ticker} onClick={() => setSelectedStock(item)} className={`bg-gray-800 p-4 rounded-xl border ${isProfit ? 'border-green-800' : 'border-blue-900'} flex justify-between items-center cursor-pointer hover:bg-gray-750 transition-all`}>
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="font-bold text-gray-100">{item.stock_name}</div>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${isProfit ? 'bg-green-900 text-green-300' : 'bg-blue-900 text-blue-300'}`}>{isProfit ? '익절' : '손절'}</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">{isProfit ? '수익금:' : '손실금:'} <span className={isProfit ? "text-red-400" : "text-blue-400"}>{netProfit !== 0 ? `${parseInt(netProfit.toString()).toLocaleString()}원` : '-'}</span></div>
                        </div>
                        <div className="text-right"><div className={`text-xl font-bold ${isProfit ? 'text-red-500' : 'text-blue-500'}`}>{item.return_rate > 0 ? "+" : ""}{item.return_rate.toFixed(1)}%</div></div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            {/* 3. 보유 중 */}
            <section>
              <h2 className="text-lg md:text-xl font-bold text-white mb-3 flex items-center gap-2 border-b border-gray-700 pb-2">
                <span className="text-gray-300">💼 보유 중인 종목</span>
                <span className="bg-gray-700 text-gray-300 text-xs px-2 py-0.5 rounded-full">{holdings.length}개</span>
              </h2>
              {holdings.length === 0 ? (
                <div className="p-6 text-center bg-gray-800/30 rounded-lg text-gray-500 border border-gray-800 border-dashed">기존 보유 종목이 없습니다.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {holdings.map((item: any) => {
                     const rate = ((item.current_price - item.avg_price) / item.avg_price) * 100;
                     return (
                      <div key={item.ticker} onClick={() => setSelectedStock(item)} className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-sm relative overflow-hidden cursor-pointer hover:bg-gray-750 hover:border-gray-500 transition-all">
                        <div className={`absolute top-0 left-0 w-1 h-full ${rate > 0 ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                        <div className="flex justify-between items-start mb-2 pl-2">
                          <div><div className="font-bold text-base text-gray-100">{item.stock_name}</div><div className="text-xs text-gray-500">{item.ticker}</div></div>
                          <div className={`text-lg font-bold ${rate > 0 ? "text-red-400" : "text-blue-400"}`}>{rate > 0 ? "+" : ""}{rate.toFixed(2)}%</div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-gray-400 pl-2 bg-gray-900/30 p-2 rounded">
                          <div>평단: <span className="text-gray-200">{parseInt(item.avg_price).toLocaleString()}</span></div>
                          <div>현재: <span className="text-gray-200">{item.current_price.toLocaleString()}</span></div>
                          <div>매수일: {item.first_buy_date}</div>
                          <div>물타기: {item.buy_count}회</div>
                        </div>
                      </div>
                     )
                  })}
                </div>
              )}
            </section>

            {/* 4. 지난 매매 내역 */}
            {pastSells.length > 0 && (
              <section className="opacity-75 hover:opacity-100 transition-opacity">
                <h2 className="text-lg md:text-xl font-bold text-gray-400 mb-3 flex items-center gap-2 border-b border-gray-700 pb-2">
                  <span>📜 지난 매매 내역</span>
                  <span className="bg-gray-800 text-gray-400 text-xs px-2 py-0.5 rounded-full">{pastSells.length}건</span>
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {pastSells.map((item: any) => {
                    const isProfit = item.return_rate > 0;
                    return (
                      <div key={item.ticker} onClick={() => setSelectedStock(item)} className="bg-gray-800/50 p-3 rounded border border-gray-700 flex justify-between items-center text-sm cursor-pointer hover:bg-gray-700">
                        <span className="text-gray-300 truncate mr-2">{item.stock_name}</span>
                        <span className={`${isProfit ? 'text-red-400' : 'text-blue-400'} font-bold whitespace-nowrap`}>{item.return_rate.toFixed(1)}%</span>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* 5. 매수 대기 */}
            <section className="opacity-80 hover:opacity-100 transition-opacity">
              <h2 className="text-lg md:text-xl font-bold text-yellow-400 mb-3 flex items-center justify-between border-b border-gray-700 pb-2">
                <span>⏳ 매수 대기 (BB하단 접근)</span>
                <span className="bg-yellow-900/50 text-yellow-300 text-xs px-2 py-1 rounded-full">{result.waiting_list.length}개</span>
              </h2>
              {result.waiting_list.length === 0 ? (
                <div className="p-6 text-center bg-gray-800/30 rounded-lg text-gray-500 border border-gray-800 border-dashed">대기 중인 종목이 없습니다.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {result.waiting_list.map((item: any) => (
                    <div key={item.ticker} onClick={() => setSelectedStock(item)} className="bg-gray-800 p-4 rounded-xl border border-gray-700 relative pl-4 cursor-pointer hover:border-yellow-500 transition-all">
                       <div className="absolute left-0 top-0 bottom-0 w-1 bg-yellow-500 rounded-l-xl"></div>
                       <div className="flex justify-between items-center mb-2">
                          <div className="font-bold text-gray-100">{item.stock_name}</div>
                          <div className="text-xs bg-yellow-900/40 text-yellow-200 px-2 py-1 rounded">Gap: {item.gap_pct.toFixed(2)}%</div>
                       </div>
                       <div className="flex justify-between items-end text-sm">
                          <div className="text-gray-400 text-xs">
                             <div>현재: {item.current_price.toLocaleString()}</div>
                             <div>목표: <span className="text-yellow-200">{parseInt(item.target_buy_price).toLocaleString()}</span></div>
                          </div>
                          <div className="text-right">
                             <div className="text-xs text-gray-500">기대수익</div>
                             <div className={`font-bold ${item.current_upside < 4.0 ? 'text-red-400' : 'text-green-400'}`}>{item.current_upside.toFixed(2)}%</div>
                          </div>
                       </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        <div className="bg-black/50 p-4 rounded-lg border border-gray-800 mt-8">
          <div className="font-bold mb-2 text-gray-400 text-xs uppercase tracking-wider">System Logs</div>
          <div className="h-32 overflow-y-auto text-xs text-gray-500 font-mono space-y-1">
            {logs.length === 0 ? <div className="opacity-30">대기 중...</div> : logs.map((log, i) => <div key={i}>{log}</div>)}
          </div>
        </div>
      </div>

      {selectedStock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setSelectedStock(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-800 flex justify-between items-center bg-gray-900 sticky top-0 z-20">
              <div><h2 className="text-xl font-bold text-white flex items-center gap-2">{selectedStock.stock_name}<span className="text-xs text-gray-500 font-normal">{selectedStock.ticker}</span></h2></div>
              <button onClick={() => setSelectedStock(null)} className="text-gray-400 hover:text-white p-2">✕</button>
            </div>
            <div className="p-5 overflow-y-auto flex-1 space-y-6">
              <div className="h-[400px] w-full bg-gray-900 rounded-lg border border-gray-800 overflow-hidden relative">
                {chartLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-500 flex-col gap-2"><div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div><div>차트 데이터 로딩 중...</div></div>
                ) : chartData.length > 0 ? (
                  <TradingViewChart key={selectedStock.ticker} data={chartData} tradeHistory={selectedStock.trade_history} />
                ) : ( <div className="absolute inset-0 flex items-center justify-center text-gray-500">차트 데이터가 없습니다.</div> )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-800 p-4 rounded-xl text-center border border-gray-700 shadow-inner"><div className="text-xs text-gray-400 mb-1">현재가</div><div className="font-bold text-xl text-white tracking-wide">{selectedStock.current_price.toLocaleString()}원</div></div>
                <div className="bg-gray-800 p-4 rounded-xl text-center border border-gray-700 shadow-inner"><div className="text-xs text-gray-400 mb-1">수익률</div><div className={`font-bold text-xl tracking-wide ${selectedStock.return_rate > 0 ? 'text-red-400' : 'text-blue-400'}`}>{selectedStock.return_rate ? selectedStock.return_rate.toFixed(2) : 0}%</div></div>
              </div>
              <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 ml-1">Transaction History</h3>
                {(!selectedStock.trade_history || selectedStock.trade_history.length === 0) ? (
                  <div className="text-center text-gray-600 py-8 text-sm bg-gray-800/30 rounded-lg">거래 내역이 없습니다.</div>
                ) : (
                  <div className="space-y-2">
                    {selectedStock.trade_history.map((log: any, idx: number) => (
                      <div key={idx} className="bg-gray-800 p-3 rounded-xl border border-gray-700 flex justify-between items-center text-sm shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${log.type.includes("매수") ? "bg-red-900/20 text-red-500" : "bg-blue-900/20 text-blue-500"}`}>{log.type.includes("매수") ? "B" : "S"}</div>
                          <div><div className="font-bold text-gray-200">{log.type}</div><div className="text-xs text-gray-500">{log.date} · {log.detail}</div></div>
                        </div>
                        <div className="text-right"><div className="font-bold text-gray-200">{parseInt(log.price).toLocaleString()}원</div><div className="text-xs text-gray-500">{log.qty}주</div></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-gray-800 bg-gray-900 text-center">
              <button onClick={() => setSelectedStock(null)} className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-3 rounded-xl transition-colors font-bold">닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
