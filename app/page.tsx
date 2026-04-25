"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  
  // 👇 [추가] 현실적인 계좌 시뮬레이션 결과를 담을 상태
  const [accountSimResult, setAccountSimResult] = useState<any>(null);

  useEffect(() => {
    const savedResult = sessionStorage.getItem('backtestResult');
    if (savedResult) {
      setResult(JSON.parse(savedResult));
    }
    const savedSim = sessionStorage.getItem('accountSimResult');
    if (savedSim) {
      setAccountSimResult(JSON.parse(savedSim));
    }
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
          } catch (e) { console.error("JSON 파싱 에러 (무시됨):", trimmedLine); }
        }
      }
    } catch (err) { alert("통신 중 에러 발생"); console.error(err); } finally { setLoading(false); }
  };

  // 👇 [추가] 천재적인 아이디어: 프론트엔드에서 시그널을 모아 시간순으로 1,000만원 시뮬레이션
  const calculateAccountReturn = () => {
    if (!result) return;

    let cash = 10000000; // 초기 시드 1천만원
    let portfolio: Record<string, any> = {};
    let allEvents: any[] = [];

    // 1. 모든 종목의 매매 시그널을 하나의 배열로 수집
    const allStocks = [...(result.holding_list || []), ...(result.profit_list || []), ...(result.loss_list || []), ...(result.waiting_list || [])];
    const uniqueStocks = new Map();
    
    allStocks.forEach(stock => {
      if (!uniqueStocks.has(stock.ticker)) {
        uniqueStocks.set(stock.ticker, stock);
        if (stock.trade_history && Array.isArray(stock.trade_history)) {
          stock.trade_history.forEach((trade: any) => {
            allEvents.push({ ...trade, ticker: stock.ticker, current_price: stock.current_price });
          });
        }
      }
    });

    // 2. 날짜 순으로 정렬 (과거 -> 현재)
    allEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // 3. 1천만원의 공통 지갑(cash)을 사용하여 시간순 시뮬레이션 진행
    allEvents.forEach(event => {
      const { type, price, ticker } = event;
      const numPrice = parseInt(price);

      if (type.includes("매수 (진입)")) {
        if (!portfolio[ticker] || portfolio[ticker].holdings === 0) {
          const investMoney = cash * 0.1; // 현재 남은 현금의 10% 진입
          const qty = Math.floor(investMoney / numPrice);
          if (qty > 0 && cash >= qty * numPrice) { // 현금이 있어야만 매수 가능!
            cash -= qty * numPrice;
            portfolio[ticker] = { holdings: qty, avg_price: numPrice, entry_amount: qty * numPrice };
          }
        }
      } else if (type.includes("매수 (물타기)")) {
        if (portfolio[ticker] && portfolio[ticker].holdings > 0) {
          const investMoney = portfolio[ticker].entry_amount; // 첫 진입 금액만큼 물타기
          const qty = Math.floor(investMoney / numPrice);
          if (qty > 0 && cash >= qty * numPrice) { // 현금이 있어야만 물타기 가능!
            const cost = qty * numPrice;
            cash -= cost;
            const totalQty = portfolio[ticker].holdings + qty;
            const totalCost = (portfolio[ticker].holdings * portfolio[ticker].avg_price) + cost;
            portfolio[ticker].holdings = totalQty;
            portfolio[ticker].avg_price = totalCost / totalQty;
          }
        }
      } else if (type.includes("매도")) {
        if (portfolio[ticker] && portfolio[ticker].holdings > 0) {
          const revenue = portfolio[ticker].holdings * numPrice;
          cash += revenue; // 익절/손절 후 현금 회수
          portfolio[ticker].holdings = 0;
        }
      }
    });

    // 4. 최종 자산 계산 (남은 현금 + 현재 보유 중인 주식들의 가치)
    let stockValue = 0;
    Object.keys(portfolio).forEach(ticker => {
      if (portfolio[ticker].holdings > 0) {
        const stockInfo = uniqueStocks.get(ticker);
        stockValue += portfolio[ticker].holdings * stockInfo.current_price;
      }
    });

    const finalAsset = cash + stockValue;
    const totalReturnRate = ((finalAsset - 10000000) / 10000000) * 100;

    const simData = {
      initial_seed: 10000000,
      final_asset: finalAsset,
      total_net_profit: finalAsset - 10000000,
      total_return_rate: totalReturnRate,
      cash: cash,
      stock_value: stockValue
    };

    setAccountSimResult(simData);
    sessionStorage.setItem('accountSimResult', JSON.stringify(simData));
  };

  let todayBuys: any[] = [];
  let holdings: any[] = [];
  let todaySells: any[] = [];
  let pastSells: any[] = [];

  if (result) {
    todayBuys = result.holding_list.filter((item: any) => item.first_buy_date === todayStr);
    holdings = result.holding_list.filter((item: any) => item.first_buy_date !== todayStr);
    const allClosed = [...result.profit_list, ...result.loss_list];

    todaySells = allClosed.filter((item: any) => {
      if (item.sell_date) return item.sell_date === todayStr;
      if (item.trade_history && item.trade_history.length > 0) {
        return item.trade_history[item.trade_history.length - 1].date === todayStr;
      }
      return false;
    });

    pastSells = allClosed.filter((item: any) => {
      if (item.sell_date) return item.sell_date !== todayStr;
      if (item.trade_history && item.trade_history.length > 0) {
        return item.trade_history[item.trade_history.length - 1].date !== todayStr;
      }
      return true;
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
            <button 
              onClick={() => runAnalysis()} 
              disabled={loading} 
              className={`w-full md:w-auto px-6 py-3 rounded-lg font-bold transition-all shadow-md ${loading ? "bg-gray-700 text-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-500 text-white active:scale-95"}`}
            >
              {loading ? `분석 중... (${progress.current}/${progress.total})` : "🚀 분석 시작"}
            </button>
            
            {/* 👇 [추가] 계좌 수익률 계산 버튼 */}
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
            {/* 👇 [수정] 버튼 클릭 시 나타나는 리얼 계좌 요약 대시보드 */}
            {accountSimResult ? (
              <section className="bg-gradient-to-r from-gray-800 to-gray-900 p-6 rounded-2xl border border-gray-700 shadow-2xl flex flex-col md:flex-row justify-between items-center gap-6">
                <div>
                  <h2 className="text-gray-400 text-sm font-bold mb-1 flex items-center gap-2">
                    <span>💰</span> 리얼 계좌 시뮬레이션 <span className="text-xs font-normal">(초기 시드: 1,000만원 공유)</span>
                  </h2>
                  <div className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-2">
                    {parseInt(accountSimResult.final_asset).toLocaleString()} <span className="text-lg text-gray-400 font-normal">원</span>
                  </div>
                  <div className="text-xs text-gray-400 bg-gray-900/50 inline-block px-3 py-1.5 rounded-lg border border-gray-700">
                    💵 남은 현금: <span className="text-white font-bold">{parseInt(accountSimResult.cash).toLocaleString()}원</span> &nbsp;|&nbsp; 
                    📈 주식 가치: <span className="text-white font-bold">{parseInt(accountSimResult.stock_value).toLocaleString()}원</span>
                  </div>
                </div>
                <div className="flex gap-6 text-right bg-gray-900/50 p-4 rounded-xl border border-gray-800 w-full md:w-auto justify-end">
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
              </section>
            ) : (
              <section className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700 border-dashed text-center">
                <div className="text-gray-400 mb-2">각 종목의 병렬 분석이 완료되었습니다.</div>
                <div className="text-sm text-gray-500">상단의 <strong className="text-blue-400">[📊 계좌 수익률계산]</strong> 버튼을 눌러 1,000만원 시드 기반의 현실적인 계좌 흐름을 확인하세요.</div>
              </section>
            )}

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

            {/* 2. 당일 매도 */}
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
                      <div key={item.ticker} onClick={() => goToDetail(item)} className="bg-gray-800/50 p-3 rounded border border-gray-700 flex justify-between items-center text-sm cursor-pointer hover:bg-gray-700">
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
                    <div key={item.ticker} onClick={() => goToDetail(item)} className="bg-gray-800 p-4 rounded-xl border border-gray-700 relative pl-4 cursor-pointer hover:border-yellow-500 transition-all">
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
    </div>
  );
}
