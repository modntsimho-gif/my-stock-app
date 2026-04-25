"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  
  const [accountSimResult, setAccountSimResult] = useState<any>(null);
  
  const [initialSeed, setInitialSeed] = useState(10000000);
  const [investRatio, setInvestRatio] = useState(10);

  useEffect(() => {
    const savedResult = sessionStorage.getItem('backtestResult');
    if (savedResult) setResult(JSON.parse(savedResult));
    
    const savedSim = sessionStorage.getItem('accountSimResult');
    if (savedSim) setAccountSimResult(JSON.parse(savedSim));
  }, []);

  const getTodayString = () => {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const koreaTimeDiff = 9 * 60 * 60 * 1000;
    const korNow = new Date(utc + koreaTimeDiff);
    return korNow.toISOString().split('T')[0];
  };

  const todayStr = getTodayString();

  const goToDetail = (item: any) => {
    sessionStorage.setItem('currentStockDetail', JSON.stringify(item));
    if (result) sessionStorage.setItem('backtestResult', JSON.stringify(result));
    if (accountSimResult) sessionStorage.setItem('accountSimResult', JSON.stringify(accountSimResult));
    router.push(`/stock/${item.ticker}`);
  };

  const runAnalysis = async () => {
    setLoading(true); setResult(null); setAccountSimResult(null); setLogs([]); setProgress({ current: 0, total: 0 });
    sessionStorage.removeItem('backtestResult');
    sessionStorage.removeItem('accountSimResult');
    sessionStorage.removeItem('currentStockDetail');

    try {
      const response = await fetch(`/api/analyze`);
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
              sessionStorage.setItem('backtestResult', JSON.stringify(data));
            } else if (data.type === "error") {
              setLogs((prev) => [...prev, `❌ 에러: ${data.message}`]);
            }
          } catch (e) {}
        }
      }
    } catch (err) { alert("통신 중 에러 발생"); } finally { setLoading(false); }
  };

  const calculateAccountReturn = () => {
    if (!result) return;

    let cash = initialSeed; 
    let portfolio: Record<string, any> = {};
    let allEvents: any[] = [];
    let executedTrades: any[] = []; 

    let currentRealizedAsset = initialSeed;
    const dailyAssetMap = new Map();

    const allStocks = [...(result.holding_list || []), ...(result.profit_list || []), ...(result.loss_list || []), ...(result.waiting_list || [])];
    const uniqueStocks = new Map();
    
    allStocks.forEach(stock => {
      if (!uniqueStocks.has(stock.ticker)) {
        uniqueStocks.set(stock.ticker, stock);
        if (stock.trade_history && Array.isArray(stock.trade_history)) {
          stock.trade_history.forEach((trade: any) => {
            allEvents.push({ ...trade, ticker: stock.ticker, stockName: stock.stock_name, current_price: stock.current_price });
          });
        }
      }
    });

    allEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    allEvents.forEach(event => {
      const { type, price, ticker, stockName, date, detail } = event;
      const numPrice = parseInt(price);

      if (type.includes("매수 (진입)")) {
        if (!portfolio[ticker] || portfolio[ticker].holdings === 0) {
          const dynamicInvestAmount = currentRealizedAsset * (investRatio / 100);
          const qty = Math.floor(dynamicInvestAmount / numPrice);
          
          if (qty > 0 && cash >= qty * numPrice) { 
            const cost = qty * numPrice;
            cash -= cost;
            portfolio[ticker] = { 
              holdings: qty, 
              avg_price: numPrice, 
              entry_amount: cost,
              base_invest_amount: dynamicInvestAmount 
            };
            executedTrades.push({ date, ticker, stockName, type, price: numPrice, qty, cash, detail });
          }
        }
      } else if (type.includes("매수 (물타기)")) {
        if (portfolio[ticker] && portfolio[ticker].holdings > 0) {
          const qty = Math.floor(portfolio[ticker].base_invest_amount / numPrice);
          
          if (qty > 0 && cash >= qty * numPrice) { 
            const cost = qty * numPrice;
            cash -= cost;
            const totalQty = portfolio[ticker].holdings + qty;
            const totalCost = (portfolio[ticker].holdings * portfolio[ticker].avg_price) + cost;
            
            portfolio[ticker].holdings = totalQty;
            portfolio[ticker].avg_price = totalCost / totalQty;
            portfolio[ticker].entry_amount += cost;
            
            executedTrades.push({ date, ticker, stockName, type, price: numPrice, qty, cash, detail });
          }
        }
      } else if (type.includes("매도")) {
        if (portfolio[ticker] && portfolio[ticker].holdings > 0) {
          const qty = portfolio[ticker].holdings;
          const avgPrice = portfolio[ticker].avg_price;
          const revenue = qty * numPrice;
          
          const realizedProfit = revenue - (qty * avgPrice);
          const profitRate = ((numPrice - avgPrice) / avgPrice) * 100;
          
          cash += revenue; 
          portfolio[ticker].holdings = 0;
          portfolio[ticker].entry_amount = 0;
          executedTrades.push({ date, ticker, stockName, type, price: numPrice, qty, cash, detail, realizedProfit, profitRate });
          
          currentRealizedAsset += realizedProfit;
        }
      }
      
      dailyAssetMap.set(date, currentRealizedAsset);
    });

    const equityCurve = Array.from(dailyAssetMap.entries())
      .map(([date, val]) => ({ time: date, value: val }))
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    let stockValue = 0;
    Object.keys(portfolio).forEach(ticker => {
      if (portfolio[ticker].holdings > 0) {
        const stockInfo = uniqueStocks.get(ticker);
        stockValue += portfolio[ticker].holdings * stockInfo.current_price;
      }
    });

    const finalAsset = cash + stockValue;
    const totalReturnRate = ((finalAsset - initialSeed) / initialSeed) * 100;

    const simData = {
      initial_seed: initialSeed,
      invest_ratio: investRatio,
      final_asset: finalAsset,
      total_net_profit: finalAsset - initialSeed,
      total_return_rate: totalReturnRate,
      cash: cash,
      stock_value: stockValue,
      executed_trades: executedTrades,
      equity_curve: equityCurve
    };

    setAccountSimResult(simData);
    sessionStorage.setItem('accountSimResult', JSON.stringify(simData));
  };

  let todayBuys: any[] = [];
  let holdings: any[] = [];
  let todaySells: any[] = [];
  let waitingList: any[] = []; 
  let allStockReturns: any[] = []; 

  if (result) {
    todayBuys = result.holding_list.filter((item: any) => item.first_buy_date === todayStr);
    holdings = result.holding_list.filter((item: any) => item.first_buy_date !== todayStr);
    
    // 👇 [수정] 백엔드에서 계산해준 gap_pct와 current_upside를 활용하여 정확히 필터링
    waitingList = (result.waiting_list || []).filter((item: any) => {
      // gap_pct: 현재가와 BB하단의 차이 (%)
      // current_upside: BB하단(또는 현재가) 대비 목표가(BB중단)까지의 기대수익률 (%)
      const gap = item.gap_pct || 0;
      const upside = item.current_upside || 0;
      return gap <= 1.5 && upside >= 3.0;
    });
    
    const allClosed = [...result.profit_list, ...result.loss_list];

    todaySells = allClosed.filter((item: any) => {
      if (item.sell_date) return item.sell_date === todayStr;
      if (item.trade_history && item.trade_history.length > 0) {
        return item.trade_history[item.trade_history.length - 1].date === todayStr;
      }
      return false;
    });

    // 👇 [수정] 백엔드의 return_rate 변수를 사용하여 전체 누적 수익률 계산
    allStockReturns = [...(result.profit_list || []), ...(result.loss_list || []), ...(result.holding_list || [])].map((item: any) => {
      // 백엔드에서 넘겨준 전략 기준 누적 수익률 (return_rate)
      const rate = item.return_rate || 0; 
      return { ...item, displayRate: rate };
    }).sort((a, b) => b.displayRate - a.displayRate);
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans md:font-mono text-sm pb-10 relative">
      <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur border-b border-gray-800 p-4 shadow-lg">
        <h1 className="text-xl md:text-2xl font-bold text-green-400 mb-3 flex items-center gap-2">
          <span>📈</span> 가자 [반포자이]로 <span className="text-xs text-gray-500 font-normal mt-1">원베일리도 낫베드</span>
        </h1>
        
        {result && (
          <div className="flex flex-col md:flex-row gap-4 items-center bg-gray-800/50 p-3 rounded-lg border border-gray-700 mb-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400 font-bold">초기 시드:</label>
              <input 
                type="number" 
                value={initialSeed} 
                onChange={e => setInitialSeed(Number(e.target.value))} 
                className="bg-gray-900 text-white px-3 py-1.5 rounded border border-gray-600 w-32 outline-none focus:border-blue-500" 
              />
              <span className="text-sm text-gray-400">원</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400 font-bold">1회 진입 비중:</label>
              <input 
                type="number" 
                value={investRatio} 
                onChange={e => setInvestRatio(Number(e.target.value))} 
                className="bg-gray-900 text-white px-3 py-1.5 rounded border border-gray-600 w-20 outline-none focus:border-blue-500" 
              />
              <span className="text-sm text-gray-400">%</span>
            </div>
          </div>
        )}

        <div>
          <div className="flex flex-col md:flex-row gap-2">
            <button 
              onClick={() => runAnalysis()} 
              disabled={loading} 
              className={`w-full md:w-auto px-6 py-3 rounded-lg font-bold transition-all shadow-md ${loading ? "bg-gray-700 text-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-500 text-white active:scale-95"}`}
            >
              {loading ? `분석 중... (${progress.current}/${progress.total})` : "🚀 분석 시작"}
            </button>
            
            {result && (
              <button 
                onClick={calculateAccountReturn}
                className="w-full md:w-auto px-6 py-3 rounded-lg font-bold transition-all shadow-md bg-blue-600 hover:bg-blue-500 text-white active:scale-95 flex items-center justify-center gap-2"
              >
                <span>📊</span> 계좌 수익률계산
              </button>
            )}
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
            <section className="bg-gray-800/40 p-5 rounded-2xl border border-gray-700">
              <h2 className="text-sm font-bold text-gray-400 mb-3 flex items-center gap-2">
                <span>📊</span> 전략 기본 통계 <span className="text-xs font-normal">(시드 무관 단순 합산)</span>
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-900/50 p-3 rounded-xl border border-gray-700/50">
                  <div className="text-xs text-gray-500 mb-1">단순 누적 수익률</div>
                  <div className={`text-xl font-bold ${result.summary?.total_return_rate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                    {result.summary?.total_return_rate >= 0 ? '+' : ''}{result.summary?.total_return_rate?.toFixed(2)}%
                  </div>
                </div>
                <div className="bg-gray-900/50 p-3 rounded-xl border border-gray-700/50">
                  <div className="text-xs text-gray-500 mb-1">익절 종목 수</div>
                  <div className="text-xl font-bold text-red-400">{result.profit_list?.length}개</div>
                </div>
                <div className="bg-gray-900/50 p-3 rounded-xl border border-gray-700/50">
                  <div className="text-xs text-gray-500 mb-1">손절 종목 수</div>
                  <div className="text-xl font-bold text-blue-400">{result.loss_list?.length}개</div>
                </div>
                <div className="bg-gray-900/50 p-3 rounded-xl border border-gray-700/50">
                  <div className="text-xs text-gray-500 mb-1">현재 보유 종목</div>
                  <div className="text-xl font-bold text-gray-300">{result.holding_list?.length}개</div>
                </div>
              </div>
            </section>

            {accountSimResult ? (
              <section className="bg-gradient-to-r from-gray-800 to-gray-900 p-6 rounded-2xl border border-gray-700 shadow-2xl flex flex-col md:flex-row justify-between items-center gap-6 relative overflow-hidden">
                <div>
                  <h2 className="text-gray-400 text-sm font-bold mb-1 flex items-center gap-2">
                    <span>💰</span> 리얼 계좌 시뮬레이션 <span className="text-xs font-normal">(초기 시드: {parseInt(accountSimResult.initial_seed).toLocaleString()}원)</span>
                  </h2>
                  <div className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-2">
                    {parseInt(accountSimResult.final_asset).toLocaleString()} <span className="text-lg text-gray-400 font-normal">원</span>
                  </div>
                  <div className="text-xs text-gray-400 bg-gray-900/50 inline-block px-3 py-1.5 rounded-lg border border-gray-700">
                    💵 남은 현금: <span className="text-white font-bold">{parseInt(accountSimResult.cash).toLocaleString()}원</span> &nbsp;|&nbsp; 
                    📈 주식 가치: <span className="text-white font-bold">{parseInt(accountSimResult.stock_value).toLocaleString()}원</span>
                  </div>
                </div>
                <div className="flex flex-col gap-3 w-full md:w-auto items-end">
                  <div className="flex gap-6 text-right bg-gray-900/50 p-4 rounded-xl border border-gray-800">
                    <div>
                      <div className="text-gray-500 text-xs mb-1">누적 수익금</div>
                      <div className={`text-xl font-bold ${accountSimResult.total_net_profit >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                        {accountSimResult.total_net_profit >= 0 ? '+' : ''}{parseInt(accountSimResult.total_net_profit).toLocaleString()}원
                      </div>
                    </div>
                    <div className="w-px bg-gray-700 mx-2"></div>
                    <div>
                      <div className="text-gray-500 text-xs mb-1">총 누적 수익률</div>
                      <div className={`text-xl font-bold ${accountSimResult.total_return_rate >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                        {accountSimResult.total_return_rate >= 0 ? '+' : ''}{accountSimResult.total_return_rate.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => router.push('/timeline')}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold py-2.5 px-5 rounded-lg transition-colors border border-blue-500 shadow-md flex items-center gap-2"
                  >
                    <span>📈</span> 전체 매매 타임라인 & 차트 보기
                  </button>
                </div>
              </section>
            ) : (
              <section className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700 border-dashed text-center">
                <div className="text-gray-400 mb-2">각 종목의 병렬 분석이 완료되었습니다.</div>
                <div className="text-sm text-gray-500">상단의 <strong className="text-blue-400">[📊 계좌 수익률계산]</strong> 버튼을 눌러 설정한 시드 기반의 현실적인 계좌 흐름을 확인하세요.</div>
              </section>
            )}

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
                      <div key={item.ticker} onClick={() => goToDetail(item)} className="bg-gray-800 p-4 rounded-xl border-2 border-red-500/30 shadow-lg relative overflow-hidden cursor-pointer hover:bg-gray-750 hover:border-red-500 transition-all">
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
                    const lastTrade = item.trade_history && item.trade_history.length > 0 
                                      ? item.trade_history[item.trade_history.length - 1] 
                                      : null;
                    const tradeProfitRate = lastTrade && lastTrade.profit_rate ? lastTrade.profit_rate : 0;
                    const netProfit = lastTrade && lastTrade.realized_profit ? lastTrade.realized_profit : 0;
                    const isProfit = netProfit > 0;

                    return (
                      <div key={item.ticker} onClick={() => goToDetail(item)} className={`bg-gray-800 p-4 rounded-xl border ${isProfit ? 'border-green-800' : 'border-blue-900'} flex justify-between items-center cursor-pointer hover:bg-gray-750 transition-all`}>
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="font-bold text-gray-100">{item.stock_name}</div>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${isProfit ? 'bg-green-900 text-green-300' : 'bg-blue-900 text-blue-300'}`}>{isProfit ? '익절' : '손절'}</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">{isProfit ? '수익금:' : '손실금:'} <span className={isProfit ? "text-red-400" : "text-blue-400"}>{netProfit !== 0 ? `${parseInt(netProfit.toString()).toLocaleString()}원` : '-'}</span></div>
                        </div>
                        <div className="text-right"><div className={`text-xl font-bold ${isProfit ? 'text-red-500' : 'text-blue-500'}`}>{tradeProfitRate > 0 ? "+" : ""}{tradeProfitRate.toFixed(1)}%</div></div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

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
                      <div key={item.ticker} onClick={() => goToDetail(item)} className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-sm relative overflow-hidden cursor-pointer hover:bg-gray-750 hover:border-gray-500 transition-all">
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

            <section>
              <h2 className="text-lg md:text-xl font-bold text-white mb-3 flex items-center gap-2 border-b border-gray-700 pb-2">
                <span className="text-yellow-500">👀 매수 대기 종목</span>
                <span className="bg-yellow-900/50 text-yellow-300 text-xs px-2 py-0.5 rounded-full">{waitingList.length}개</span>
              </h2>
              {waitingList.length === 0 ? (
                <div className="p-6 text-center bg-gray-800/30 rounded-lg text-gray-500 border border-gray-800 border-dashed">현재 타점에 들어온 대기 종목이 없습니다.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {waitingList.map((item: any) => (
                    <div key={item.ticker} onClick={() => goToDetail(item)} className="bg-gray-800/50 p-4 rounded-xl border border-yellow-700/50 shadow-sm cursor-pointer hover:bg-gray-750 transition-all">
                      <div className="flex justify-between items-center mb-2">
                        <div>
                          <div className="font-bold text-base text-gray-300">{item.stock_name}</div>
                          <div className="text-xs text-gray-500">{item.ticker}</div>
                        </div>
                        <div className="text-sm font-bold text-yellow-400">{item.current_price.toLocaleString()}원</div>
                      </div>
                      <div className="text-xs text-gray-400 bg-yellow-900/20 p-2 rounded border border-yellow-900/50">
                        🔥 하단 1.5% 이내 & 기대수익 3% 이상 도달!
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 👇 [추가] 모든 종목 누적 수익률 카드 그리드 */}
            <section>
              <h2 className="text-lg md:text-xl font-bold text-white mb-3 flex items-center gap-2 border-b border-gray-700 pb-2 mt-8">
                <span className="text-purple-400">🏆 모든 종목 누적 수익률</span>
                <span className="bg-purple-900/50 text-purple-300 text-xs px-2 py-0.5 rounded-full">{allStockReturns.length}개</span>
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {allStockReturns.map((item: any, idx: number) => (
                  <div key={idx} onClick={() => goToDetail(item)} className="bg-gray-800 p-3 rounded-xl border border-gray-700 shadow-sm cursor-pointer hover:bg-gray-750 transition-all flex flex-col justify-between">
                    <div>
                      <div className="font-bold text-gray-200 text-sm truncate">{item.stock_name}</div>
                      <div className="text-xs text-gray-500">{item.ticker}</div>
                    </div>
                    <div className={`text-lg font-bold mt-2 text-right ${item.displayRate > 0 ? 'text-red-400' : item.displayRate < 0 ? 'text-blue-400' : 'text-gray-400'}`}>
                      {item.displayRate > 0 ? '+' : ''}{item.displayRate.toFixed(2)}%
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
